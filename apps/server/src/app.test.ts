import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { MockTtsProvider } from "./providers/mock.js";
import type { SharedVoiceQuery, SynthesizeInput, TtsProvider, VoiceListQuery } from "./providers/types.js";
import { testConfig } from "./test-helpers.js";

async function json(response: { body: string }): Promise<Record<string, unknown>> {
  return JSON.parse(response.body) as Record<string, unknown>;
}

async function waitForBatch(app: FastifyInstance, id: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const body = await json(await app.inject({ method: "GET", url: `/api/tts/batches/${id}` }));
    if (!["queued", "running", "retry_wait"].includes(String(body.status))) return body;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  throw new Error("Batch did not finish");
}

class FakeElevenLabsProvider implements TtsProvider {
  readonly name = "elevenlabs" as const;
  private readonly mock = new MockTtsProvider();
  testConnection() { return Promise.resolve({ ok: true as const, account: { tier: "test" } }); }
  listAccountVoices(query: VoiceListQuery) { return this.mock.listAccountVoices(query); }
  listSharedVoices(query: SharedVoiceQuery) { return this.mock.listSharedVoices(query); }
  addSharedVoice(publicOwnerId: string, voiceId: string, input: { newName: string; bookmarked?: boolean }) {
    return this.mock.addSharedVoice(publicOwnerId, voiceId, input);
  }
  fetchSharedVoicePreview(previewUrl: string, range?: string) { return this.mock.fetchSharedVoicePreview(previewUrl, range); }
  getUsage() { return this.mock.getUsage(); }
  synthesize(input: SynthesizeInput) { return this.mock.synthesize(input); }
}

describe("local API workflow", () => {
  const cleanups: Array<() => void> = [];
  const apps: FastifyInstance[] = [];

  afterEach(async () => {
    while (apps.length) await apps.pop()?.close();
    while (cleanups.length) cleanups.pop()?.();
  });

  it("browses Shared Voices without a key, proxies previews, and guards account changes", async () => {
    const setup = testConfig();
    cleanups.push(setup.cleanup);
    const built = await buildApp({
      config: setup.config,
      provider: new MockTtsProvider(),
      elevenLabsProvider: new MockTtsProvider(),
      startQueue: false,
    });
    apps.push(built.app);

    const response = await built.app.inject({
      method: "GET",
      url: "/api/voices/shared?language=es&useCase=conversational&sort=trending&page=0&pageSize=24",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const result = await json(response);
    expect(result).toMatchObject({
      page: 0,
      pageSize: 24,
      hasMore: false,
      totalCount: 1,
      voices: [{
        publicOwnerId: "mock-owner",
        voiceId: "mock-shared-mara",
        descriptive: ["warm", "clear"],
        useCase: ["conversational"],
        previewUrl: "https://storage.googleapis.com/eleven-public-prod/mock/shared-preview.mp3",
      }],
    });

    const previewUrl = encodeURIComponent("https://storage.googleapis.com/eleven-public-prod/mock/shared-preview.mp3");
    const preview = await built.app.inject({ method: "GET", url: `/api/voices/shared/preview?url=${previewUrl}` });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers["content-type"]).toBe("audio/wav");
    expect(preview.headers["x-content-type-options"]).toBe("nosniff");
    expect(preview.headers["cache-control"]).toBe("no-store");
    expect(preview.rawPayload.byteLength).toBeGreaterThan(44);

    const add = await built.app.inject({
      method: "POST",
      url: "/api/voices/shared/mock-owner/mock-shared-mara/add",
      payload: { newName: "Mara" },
    });
    expect(add.statusCode).toBe(400);
    expect(await json(add)).toMatchObject({ error: { code: "ELEVENLABS_NOT_CONFIGURED" } });
  });

  it("imports, enforces calibration, generates, reviews, ranges, and exports", async () => {
    const setup = testConfig();
    cleanups.push(setup.cleanup);
    const built = await buildApp({ config: setup.config, provider: new FakeElevenLabsProvider(), elevenLabsProvider: new MockTtsProvider() });
    apps.push(built.app);

    const health = await built.app.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);

    const projectResponse = await built.app.inject({ method: "POST", url: "/api/projects", payload: { name: "Mara library", code: "mara" } });
    const project = await json(projectResponse);
    const projectId = String(project.id);

    const boundary = "voice-foundry-boundary";
    const multipart = [
      `--${boundary}\r\nContent-Disposition: form-data; name="projectId"\r\n\r\n${projectId}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="phrases.csv"\r\nContent-Type: text/csv\r\n\r\nid,text,group\nhello,Hola,opening\nbye,Seguimos,opening\n\r\n`,
      `--${boundary}--\r\n`,
    ].join("");
    const importedResponse = await built.app.inject({
      method: "POST", url: "/api/imports", headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, payload: multipart,
    });
    expect(importedResponse.statusCode).toBe(201);
    expect(await json(importedResponse)).toMatchObject({ insertedRows: 2 });

    const profileResponse = await built.app.inject({
      method: "POST", url: "/api/voice-profiles", payload: {
        projectId, label: "Mara v1", voiceId: "mock-mara", voiceName: "Mara", modelId: "eleven_multilingual_v2",
        languageCode: "es", outputFormat: "mp3_44100_128",
        settings: { stability: 0.5, similarityBoost: 0.75, style: 0, speed: 1, useSpeakerBoost: true }, notes: "test",
      },
    });
    const profile = await json(profileResponse);
    const profileId = String(profile.id);
    await built.app.inject({ method: "POST", url: `/api/voice-profiles/${profileId}/lock`, payload: {} });

    const blocked = await json(await built.app.inject({
      method: "POST", url: "/api/tts/preflight", payload: { projectId, voiceProfileVersionId: profileId, mode: "first_pass" },
    }));
    expect(blocked).toMatchObject({ allowed: false });
    expect(blocked.blockingReasons).toEqual(expect.arrayContaining([expect.stringContaining("calibration")]));

    const generationResponse = await built.app.inject({
      method: "POST", url: "/api/tts/batches", payload: { projectId, voiceProfileVersionId: profileId, mode: "regeneration", confirmed: true },
    });
    expect(generationResponse.statusCode).toBe(202);
    const generatedBatch = await waitForBatch(built.app, String((await json(generationResponse)).id));
    const jobs = generatedBatch.jobs as Array<Record<string, unknown>>;
    const takeId = String(jobs[0]?.takeId);
    const phraseId = String(jobs[0]?.phraseId);

    await built.app.inject({ method: "POST", url: `/api/audio/${takeId}/review`, payload: { status: "alternate" } });
    const batchResponse = await built.app.inject({
      method: "POST", url: "/api/tts/batches", payload: { projectId, voiceProfileVersionId: profileId, mode: "calibration", confirmed: true },
    });
    expect(batchResponse.statusCode).toBe(202);
    const batch = await json(batchResponse);
    expect(batch).toMatchObject({ status: "succeeded", completedJobs: 2, queuedJobs: 0, runningJobs: 0 });
    expect((batch.jobs as Array<Record<string, unknown>>).every((job) => job.reused === true)).toBe(true);

    const reuseApproved = await json(await built.app.inject({
      method: "POST", url: "/api/tts/preflight", payload: { projectId, voiceProfileVersionId: profileId, mode: "first_pass" },
    }));
    expect(reuseApproved).toMatchObject({ allowed: true });

    const firstChunk = await json(await built.app.inject({
      method: "POST", url: "/api/tts/preflight", payload: {
        projectId, voiceProfileVersionId: profileId, mode: "first_pass", missingOnly: true, limit: 1,
      },
    }));
    expect(firstChunk).toMatchObject({
      allowed: false,
      selection: { missingOnly: true, selectedCount: 0, remainingCount: 0, totalMissingCount: 0 },
    });

    const secondProfileResponse = await built.app.inject({
      method: "POST", url: "/api/voice-profiles", payload: {
        projectId, label: "Mara v2", voiceId: "mock-mara", voiceName: "Mara", modelId: "eleven_multilingual_v2",
        languageCode: "es", outputFormat: "mp3_44100_128",
        settings: { stability: 0.6, similarityBoost: 0.75, style: 0, speed: 1, useSpeakerBoost: true }, notes: "new recipe",
      },
    });
    const secondProfile = await json(secondProfileResponse);
    const secondProfileId = String(secondProfile.id);
    await built.app.inject({ method: "POST", url: `/api/voice-profiles/${secondProfileId}/lock`, payload: {} });
    const nextRecipe = await json(await built.app.inject({
      method: "POST", url: "/api/tts/preflight", payload: {
        projectId, voiceProfileVersionId: secondProfileId, mode: "first_pass", missingOnly: true, limit: 1,
      },
    }));
    expect(nextRecipe).toMatchObject({
      allowed: false,
      selection: { missingOnly: true, selectedCount: 1, remainingCount: 1, totalMissingCount: 2 },
    });
    expect(nextRecipe.blockingReasons).toEqual(expect.arrayContaining([expect.stringContaining("calibration")]));
    await built.app.inject({ method: "POST", url: `/api/voice-profiles/${profileId}/lock`, payload: {} });

    const audio = await built.app.inject({ method: "GET", url: `/api/audio/${takeId}`, headers: { range: "bytes=0-31" } });
    expect(audio.statusCode).toBe(206);
    expect(audio.rawPayload.byteLength).toBe(32);

    const reviewed = await built.app.inject({ method: "POST", url: `/api/audio/${takeId}/review`, payload: { decision: "kept" } });
    expect(reviewed.statusCode).toBe(200);
    expect(await json(reviewed)).toMatchObject({ id: phraseId, decision: "kept", selectedTakeId: takeId });

    const allowed = await json(await built.app.inject({
      method: "POST", url: "/api/tts/preflight", payload: { projectId, voiceProfileVersionId: profileId, mode: "first_pass" },
    }));
    expect(allowed).toMatchObject({ allowed: true, reusedJobs: 2, newJobs: 0, totalCharacters: 0 });

    const preview = await json(await built.app.inject({ method: "POST", url: "/api/exports/preview", payload: { projectId } }));
    expect(preview).toMatchObject({ valid: true, canExport: true, assetCount: 1 });
    const createdExportResponse = await built.app.inject({ method: "POST", url: "/api/exports", payload: { projectId, label: "Test export" } });
    expect(createdExportResponse.statusCode).toBe(201);
    const createdExport = await json(createdExportResponse);
    expect(existsSync(String(createdExport.folderPath))).toBe(true);
    const downloaded = await built.app.inject({ method: "GET", url: String(createdExport.downloadUrl) });
    expect(downloaded.statusCode).toBe(200);
    expect(downloaded.headers["content-type"]).toContain("application/zip");
    expect(downloaded.rawPayload.subarray(0, 2).toString()).toBe("PK");

    const metadataPatch = await built.app.inject({ method: "PATCH", url: `/api/phrases/${phraseId}`, payload: { metadata: { source: "revised" } } });
    expect(metadataPatch.statusCode).toBe(200);
    const revisedPreview = await json(await built.app.inject({ method: "POST", url: "/api/exports/preview", payload: { projectId } }));
    expect(revisedPreview.fingerprint).not.toBe(preview.fingerprint);
    const revisedExport = await json(await built.app.inject({ method: "POST", url: "/api/exports", payload: { projectId, label: "Test export" } }));
    expect(revisedExport.id).not.toBe(createdExport.id);

    const edited = await json(await built.app.inject({ method: "PATCH", url: `/api/phrases/${phraseId}`, payload: { synthesisText: "Texto nuevo" } }));
    expect(edited).toMatchObject({ selectedTakeId: null, primaryCount: 0 });
    const stalePreview = await json(await built.app.inject({ method: "POST", url: "/api/exports/preview", payload: { projectId } }));
    expect(stalePreview).toMatchObject({ valid: false, canExport: false });

    const zeroAudioId = "no-audio";
    const secondBoundary = "zero-audio-boundary";
    const secondUpload = [
      `--${secondBoundary}\r\nContent-Disposition: form-data; name="projectId"\r\n\r\n${projectId}\r\n`,
      `--${secondBoundary}\r\nContent-Disposition: form-data; name="file"; filename="more.csv"\r\nContent-Type: text/csv\r\n\r\nid,text\n${zeroAudioId},Sin audio\n\r\n`,
      `--${secondBoundary}--\r\n`,
    ].join("");
    await built.app.inject({ method: "POST", url: "/api/imports", headers: { "content-type": `multipart/form-data; boundary=${secondBoundary}` }, payload: secondUpload });
    const phrasePage = await json(await built.app.inject({ method: "GET", url: `/api/phrases?projectId=${projectId}&search=${zeroAudioId}&page=1&pageSize=10` }));
    const zeroAudioPhraseId = String((phrasePage.items as Array<Record<string, unknown>>)[0]?.id);
    const reviewPage = await json(await built.app.inject({ method: "GET", url: `/api/review?projectId=${projectId}&page=1&pageSize=100` }));
    expect((reviewPage.items as Array<Record<string, unknown>>).some((item) => item.id === zeroAudioPhraseId)).toBe(false);

    await built.queue.stop();
    const generatedBatchId = String(generatedBatch.id);
    const now = new Date().toISOString();
    built.database.sqlite.prepare("UPDATE tts_batches SET status = 'running', completed_at = NULL, updated_at = ? WHERE id = ?").run(now, generatedBatchId);
    built.database.sqlite.prepare("UPDATE tts_jobs SET status = 'queued', completed_at = NULL, updated_at = ? WHERE id = ?").run(now, String(jobs[0]?.id));
    const listed = await json(await built.app.inject({ method: "GET", url: `/api/tts/batches?projectId=${projectId}` }));
    expect((listed.batches as Array<Record<string, unknown>>).some((item) => item.id === generatedBatchId)).toBe(true);
    const restoredDashboard = await json(await built.app.inject({ method: "GET", url: `/api/dashboard?projectId=${projectId}` }));
    expect(restoredDashboard.activeBatch).toMatchObject({ id: generatedBatchId, status: "running" });
  });

  it("accepts projectId after the file part and rejects foreign browser origins", async () => {
    const setup = testConfig();
    cleanups.push(setup.cleanup);
    const built = await buildApp({ config: setup.config, provider: new MockTtsProvider(), elevenLabsProvider: new MockTtsProvider(), startQueue: false });
    apps.push(built.app);
    const target = await json(await built.app.inject({ method: "POST", url: "/api/projects", payload: { name: "Target" } }));
    const fallback = await json(await built.app.inject({ method: "POST", url: "/api/projects", payload: { name: "Fallback" } }));
    expect(fallback.id).not.toBe(target.id);
    const boundary = "file-first-boundary";
    const multipart = [
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="phrases.txt"\r\nContent-Type: text/plain\r\n\r\nHola\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="projectId"\r\n\r\n${String(target.id)}\r\n`,
      `--${boundary}--\r\n`,
    ].join("");
    const imported = await built.app.inject({ method: "POST", url: "/api/imports", headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, payload: multipart });
    expect(imported.statusCode).toBe(201);
    expect(await json(imported)).toMatchObject({ projectId: target.id });
    const foreign = await built.app.inject({ method: "POST", url: "/api/projects", headers: { origin: "https://evil.example" }, payload: { name: "Rejected" } });
    expect(foreign.statusCode).toBe(403);
    expect(await json(foreign)).toMatchObject({ error: { code: "FOREIGN_ORIGIN_REJECTED" } });
  });

  it("does not reuse or export takes across provider provenance", async () => {
    const setup = testConfig();
    cleanups.push(setup.cleanup);
    const mockBuilt = await buildApp({ config: setup.config, provider: new MockTtsProvider(), elevenLabsProvider: new MockTtsProvider() });
    const project = await json(await mockBuilt.app.inject({ method: "POST", url: "/api/projects", payload: { name: "Provider test" } }));
    const projectId = String(project.id);
    const boundary = "provider-boundary";
    const upload = [
      `--${boundary}\r\nContent-Disposition: form-data; name="projectId"\r\n\r\n${projectId}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="one.txt"\r\nContent-Type: text/plain\r\n\r\nHola\r\n`,
      `--${boundary}--\r\n`,
    ].join("");
    await mockBuilt.app.inject({ method: "POST", url: "/api/imports", headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, payload: upload });
    const mockProfile = await json(await mockBuilt.app.inject({ method: "POST", url: "/api/voice-profiles", payload: {
      projectId, label: "Mock profile", voiceId: "same-id", voiceName: "Mara", modelId: "same-model",
      languageCode: "es", outputFormat: "mp3_44100_128",
      settings: { stability: 0.5, similarityBoost: 0.75, style: 0, speed: 1, useSpeakerBoost: true }, notes: "",
    } }));
    expect(mockProfile).toMatchObject({ provider: "mock" });
    await mockBuilt.app.inject({ method: "POST", url: `/api/voice-profiles/${String(mockProfile.id)}/lock`, payload: {} });
    const mockBatch = await json(await mockBuilt.app.inject({ method: "POST", url: "/api/tts/batches", payload: {
      projectId, voiceProfileVersionId: mockProfile.id, mode: "calibration", confirmed: true,
    } }));
    const finished = await waitForBatch(mockBuilt.app, String(mockBatch.id));
    const takeId = String((finished.jobs as Array<Record<string, unknown>>)[0]?.takeId);
    await mockBuilt.app.inject({ method: "POST", url: `/api/audio/${takeId}/review`, payload: { decision: "kept" } });
    const mockExport = await json(await mockBuilt.app.inject({ method: "POST", url: "/api/exports/preview", payload: { projectId } }));
    expect(mockExport).toMatchObject({ valid: true });
    expect(mockExport.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "MOCK_EXPORT" })]));
    await mockBuilt.queue.stop();
    const oldJobId = String((finished.jobs as Array<Record<string, unknown>>)[0]?.id);
    const now = new Date().toISOString();
    mockBuilt.database.sqlite.prepare("UPDATE tts_jobs SET status = 'queued', completed_at = NULL, updated_at = ? WHERE id = ?").run(now, oldJobId);
    mockBuilt.database.sqlite.prepare("UPDATE tts_batches SET status = 'running', completed_at = NULL, updated_at = ? WHERE id = ?").run(now, finished.id);
    await mockBuilt.app.close();

    const liveBuilt = await buildApp({ config: { ...setup.config, ttsProvider: "elevenlabs" }, provider: new FakeElevenLabsProvider(), elevenLabsProvider: new FakeElevenLabsProvider(), startQueue: false });
    apps.push(liveBuilt.app);
    liveBuilt.queue.recover();
    const recoveredJob = liveBuilt.database.sqlite.prepare("SELECT status FROM tts_jobs WHERE id = ?").get(oldJobId) as { status: string };
    const recoveredBatch = liveBuilt.database.sqlite.prepare("SELECT status FROM tts_batches WHERE id = ?").get(finished.id) as { status: string };
    expect(recoveredJob.status).toBe("queued");
    expect(recoveredBatch.status).toBe("paused_provider");
    const oldProfilePreflight = await liveBuilt.app.inject({ method: "POST", url: "/api/tts/preflight", payload: {
      projectId, voiceProfileVersionId: mockProfile.id, mode: "calibration",
    } });
    expect(oldProfilePreflight.statusCode).toBe(409);
    expect(await json(oldProfilePreflight)).toMatchObject({ error: { code: "VOICE_PROFILE_PROVIDER_MISMATCH" } });
  });
});
