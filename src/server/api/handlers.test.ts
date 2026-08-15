import { describe, expect, it, vi } from "vitest";
import type { AudioStream, VoiceProvider } from "../elevenlabs/types";
import { createStatelessApi } from "./handlers";

function testAudio(): AudioStream {
  return {
    stream: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x49, 0x44, 0x33]));
        controller.close();
      },
    }),
    mimeType: "audio/mpeg",
    status: 200,
    contentLength: 3,
    acceptRanges: null,
    contentRange: null,
    providerRequestId: "provider-request-1",
    characterCost: 4,
  };
}

function fakeProvider(): VoiceProvider {
  return {
    name: "elevenlabs",
    listAccountVoices: vi.fn(async () => ({ voices: [], hasMore: false, nextPageToken: null, totalCount: 0 })),
    listSharedVoices: vi.fn(async (query) => ({ voices: [], page: query.page, pageSize: query.pageSize, hasMore: false, totalCount: 0 })),
    addSharedVoice: vi.fn(async (_owner, voiceId) => ({ voiceId: `account-${voiceId}` })),
    previewSharedVoice: vi.fn(async () => testAudio()),
    synthesize: vi.fn(async () => testAudio()),
  };
}

const validSpeechBody = {
  text: "Hola",
  voiceId: "voice-1",
  modelId: "eleven_multilingual_v2",
  languageCode: "es",
  outputFormat: "mp3_44100_128",
  seed: 17,
  settings: { stability: 0.5, similarityBoost: 0.75, style: 0, speed: 1, useSpeakerBoost: true },
};

function postRequest(path: string, body: unknown, origin = "https://voice.example"): Request {
  return new Request(`https://voice.example${path}`, {
    method: "POST",
    headers: { host: "voice.example", origin, "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body),
  });
}

describe("stateless API handlers", () => {
  it("requires an exact same origin before any paid generation", async () => {
    const provider = fakeProvider();
    const api = createStatelessApi({ getProvider: () => provider });
    const missingOrigin = new Request("https://voice.example/api/speech", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validSpeechBody),
    });
    const missingResponse = await api.synthesize(missingOrigin);
    expect(missingResponse.status).toBe(403);
    expect(await missingResponse.json()).toMatchObject({ error: { code: "SAME_ORIGIN_REQUIRED" } });

    const crossOriginResponse = await api.synthesize(postRequest("/api/speech", validSpeechBody, "https://evil.example"));
    expect(crossOriginResponse.status).toBe(403);
    const forgedForwardedHost = postRequest("/api/speech", validSpeechBody, "https://evil.example");
    forgedForwardedHost.headers.set("x-forwarded-host", "evil.example");
    expect((await api.synthesize(forgedForwardedHost)).status).toBe(403);
    expect(provider.synthesize).not.toHaveBeenCalled();
  });

  it("strictly validates the recipe before contacting ElevenLabs", async () => {
    const provider = fakeProvider();
    const api = createStatelessApi({ getProvider: () => provider });
    const response = await api.synthesize(postRequest("/api/speech", { ...validSpeechBody, unexpected: true }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_REQUEST", retryable: false } });
    expect(provider.synthesize).not.toHaveBeenCalled();
  });

  it("streams generated audio with private, no-sniff headers", async () => {
    const provider = fakeProvider();
    const api = createStatelessApi({ getProvider: () => provider });
    const response = await api.synthesize(postRequest("/api/speech", validSpeechBody));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(response.headers.get("content-length")).toBe("3");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(response.headers.get("x-provider-request-id")).toBe("provider-request-1");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0x49, 0x44, 0x33]));
    expect(provider.synthesize).toHaveBeenCalledWith(validSpeechBody);
  });

  it("validates add-voice params/body and returns the account voice ID", async () => {
    const provider = fakeProvider();
    const api = createStatelessApi({ getProvider: () => provider });
    const response = await api.addSharedVoice(
      postRequest("/api/voices/shared/owner-1/voice-1/add", { newName: "Sol", bookmarked: false }),
      { publicOwnerId: "owner-1", voiceId: "voice-1" },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ voiceId: "account-voice-1" });
    expect(provider.addSharedVoice).toHaveBeenCalledWith("owner-1", "voice-1", { newName: "Sol", bookmarked: false });

    const invalid = await api.addSharedVoice(
      postRequest("/api/voices/shared/owner/voice/add", {}),
      { publicOwnerId: "../owner", voiceId: "voice" },
    );
    expect(invalid.status).toBe(400);
  });

  it("merges repeated Shared Voice filters without accepting unknown query fields", async () => {
    const provider = fakeProvider();
    const api = createStatelessApi({ getProvider: () => provider });
    const response = await api.listSharedVoices(new Request(
      "https://voice.example/api/voices/shared?page=1&pageSize=10&useCase=conversational&useCases=narration&useCase=conversational",
    ));
    expect(response.status).toBe(200);
    expect(provider.listSharedVoices).toHaveBeenCalledWith(expect.objectContaining({
      page: 1,
      pageSize: 10,
      useCases: ["conversational", "narration"],
    }));

    const unknown = await api.listSharedVoices(new Request(
      "https://voice.example/api/voices/shared?page=0&surprise=true",
    ));
    expect(unknown.status).toBe(400);
  });
});
