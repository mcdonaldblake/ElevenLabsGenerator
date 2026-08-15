import { createReadStream, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { bulkReviewSchema, createTtsBatchSchema, exportRequestSchema, phrasePatchSchema, reviewDecisionSchema, voiceProfileInputSchema, voiceSettingsSchema } from "@voice-foundry/schemas";
import { z } from "zod";
import type { ServerConfig } from "../config.js";
import { maskedSecret } from "../config.js";
import type { DatabaseContext } from "../db/client.js";
import { AppError, notFound } from "../errors.js";
import type { TtsQueue } from "../jobs/queue.js";
import type { TtsProvider } from "../providers/index.js";
import type { ImportService } from "../services/imports.js";
import type { ExportService } from "../services/exports.js";
import type { LibraryService, PhraseQuery } from "../services/library.js";
import type { ProfileService } from "../services/profiles.js";

export type ApiDependencies = {
  config: ServerConfig;
  database: DatabaseContext;
  queue: TtsQueue;
  provider: TtsProvider;
  elevenLabsProvider: TtsProvider;
  imports: ImportService;
  exports: ExportService;
  library: LibraryService;
  profiles: ProfileService;
  startedAt: number;
};

const projectInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2_000).default(""),
  code: z.string().trim().max(100).optional(),
});

const projectQuerySchema = z.object({ projectId: z.string().min(1).optional() });

const phraseQuerySchema = z.object({
  projectId: z.string().min(1),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
  search: z.string().trim().max(500).optional(),
  decision: z.enum(["pending", "kept", "discarded"]).optional(),
  audioStatus: z.enum(["no_audio", "pending_review", "primary_selected", "reviewed_no_primary"]).optional(),
});

const extendedPhrasePatchSchema = phrasePatchSchema.extend({
  tone: z.string().trim().max(100).optional(),
  englishMeaning: z.string().trim().max(5_000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const batchRequestSchema = createTtsBatchSchema.extend({
  missingOnly: z.boolean().default(false),
  limit: z.number().int().min(1).max(100_000).optional(),
});

const preflightSchema = batchRequestSchema.omit({ confirmed: true }).extend({
  mode: z.enum(["calibration", "first_pass", "regeneration"]).default("first_pass"),
});

const reviewTakeSchema = z.object({
  status: z.enum(["pending", "primary", "alternate", "rejected"]).optional(),
  reviewStatus: z.enum(["pending", "primary", "alternate", "rejected"]).optional(),
  decision: z.enum(["pending", "kept", "discarded", "primary", "alternate", "rejected"]).optional(),
  notes: z.string().trim().max(5_000).optional(),
}).refine((value) => value.status || value.reviewStatus || value.decision, "A review decision is required.");

const regenerationSchema = z.object({
  seed: z.number().int().min(0).max(2_147_483_646).optional(),
  settings: voiceSettingsSchema.optional(),
}).default({});

const profileInputSchema = voiceProfileInputSchema.extend({ notes: z.string().trim().max(5_000).default("") });

const settingsPatchSchema = z.object({
  lastProjectId: z.string().min(1).nullable().optional(),
  lastPage: z.string().trim().max(200).optional(),
  autoAdvance: z.boolean().optional(),
  blindMode: z.boolean().optional(),
}).strict();

const queryBooleanSchema = z.preprocess((value) => {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return value;
}, z.boolean());

const queryStringListSchema = z.union([
  z.string(),
  z.array(z.string()),
]).transform((value) => (Array.isArray(value) ? value : [value]).map((item) => item.trim()).filter(Boolean));

const sharedVoiceQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(0).default(0),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
  category: z.enum(["professional", "famous", "high_quality"]).optional(),
  gender: z.string().trim().max(100).optional(),
  age: z.string().trim().max(100).optional(),
  accent: z.string().trim().max(100).optional(),
  language: z.string().trim().max(100).optional(),
  locale: z.string().trim().max(100).optional(),
  useCase: queryStringListSchema.optional(),
  useCases: queryStringListSchema.optional(),
  descriptive: queryStringListSchema.optional(),
  descriptives: queryStringListSchema.optional(),
  featured: queryBooleanSchema.optional(),
  minNoticePeriodDays: z.coerce.number().int().min(0).optional(),
  includeCustomRates: queryBooleanSchema.optional(),
  includeLiveModerated: queryBooleanSchema.optional(),
  readerAppEnabled: queryBooleanSchema.optional(),
  ownerId: z.string().trim().max(200).optional(),
  sort: z.enum(["created_date", "usage_character_count_1y", "trending", "cloned_by_count"]).optional(),
}).strict();

const sharedVoiceIdSchema = z.object({
  publicOwnerId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  voiceId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
});

const addSharedVoiceInputSchema = z.object({
  newName: z.string().trim().min(1).max(100).optional(),
  bookmarked: z.boolean().optional(),
}).strict().default({});

async function readImportMultipart(request: FastifyRequest, maxBytes: number): Promise<{
  buffer: Buffer;
  fileName: string;
  projectId: string | null;
}> {
  let buffer: Buffer | null = null;
  let fileName = "";
  let projectId: string | null = null;
  for await (const part of request.parts({ limits: { fileSize: maxBytes, files: 1 } })) {
    if (part.type === "file") {
      if (part.fieldname !== "file") {
        part.file.resume();
        throw new AppError(400, "INVALID_IMPORT_FILE_FIELD", "Attach the import in the file field.");
      }
      buffer = await part.toBuffer();
      fileName = part.filename;
    } else if (part.fieldname === "projectId" && typeof part.value === "string") {
      projectId = part.value.trim() || null;
    }
  }
  if (!buffer) throw new AppError(400, "IMPORT_FILE_REQUIRED", "Attach one import file in the file field.");
  return { buffer, fileName, projectId };
}

function phraseQuery(value: unknown): PhraseQuery {
  return phraseQuerySchema.parse(value);
}

function takeReviewStatus(input: z.infer<typeof reviewTakeSchema>): "pending" | "primary" | "alternate" | "rejected" {
  const value = input.status ?? input.reviewStatus ?? input.decision;
  if (value === "kept") return "primary";
  if (value === "discarded") return "rejected";
  return value ?? "pending";
}

function sendAudioRange(reply: FastifyReply, absolutePath: string, mimeType: string, rangeHeader: string | undefined): FastifyReply {
  const information = statSync(absolutePath);
  if (!information.isFile()) throw notFound("Audio file");
  reply.header("accept-ranges", "bytes").header("content-type", mimeType).header("cache-control", "private, max-age=31536000, immutable");
  if (!rangeHeader) {
    reply.header("content-length", information.size);
    return reply.send(createReadStream(absolutePath));
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match) throw new AppError(416, "INVALID_RANGE", "The requested audio byte range is invalid.");
  const startText = match[1] ?? "";
  const endText = match[2] ?? "";
  let start: number;
  let end: number;
  if (!startText && endText) {
    const suffix = Number(endText);
    start = Math.max(0, information.size - suffix);
    end = information.size - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : information.size - 1;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= information.size) {
    reply.header("content-range", `bytes */${information.size}`);
    throw new AppError(416, "RANGE_NOT_SATISFIABLE", "The requested audio byte range is not satisfiable.");
  }
  end = Math.min(end, information.size - 1);
  reply.code(206).header("content-range", `bytes ${start}-${end}/${information.size}`).header("content-length", end - start + 1);
  return reply.send(createReadStream(absolutePath, { start, end }));
}

function readSettings(database: DatabaseContext): Record<string, unknown> {
  const rows = database.sqlite.prepare("SELECT key, value_json FROM app_settings").all() as Array<{ key: string; value_json: string }>;
  return Object.fromEntries(rows.map((row) => {
    try { return [row.key, JSON.parse(row.value_json) as unknown]; } catch { return [row.key, null]; }
  }));
}

export async function registerApiRoutes(app: FastifyInstance, dependencies: ApiDependencies): Promise<void> {
  const { config, database, queue, provider, elevenLabsProvider, imports, exports: exportService, library, profiles } = dependencies;

  app.get("/api/health", async () => {
    const databaseOk = Boolean(database.sqlite.prepare("SELECT 1 AS ok").get());
    return {
      ok: databaseOk,
      status: databaseOk ? "ok" : "degraded",
      server: "frase-uno-voice-foundry",
      database: { ok: databaseOk },
      provider: { mode: provider.name, configured: provider.name === "mock" || Boolean(config.elevenLabsApiKey) },
      providerMode: provider.name,
      mode: provider.name,
      version: "0.1.0",
      uptimeSeconds: Math.floor((Date.now() - dependencies.startedAt) / 1_000),
      now: new Date().toISOString(),
    };
  });

  app.get("/api/dashboard", async (request) => library.dashboard(projectQuerySchema.parse(request.query).projectId));
  app.get("/api/projects", async () => ({ projects: library.listProjects() }));
  app.post("/api/projects", async (request, reply) => reply.code(201).send(library.createProject(projectInputSchema.parse(request.body))));

  app.post("/api/imports/preview", async (request) => {
    const upload = await readImportMultipart(request, config.maxImportBytes);
    return imports.preview(upload.buffer, upload.fileName, upload.projectId);
  });

  app.post("/api/imports", async (request, reply) => {
    const upload = await readImportMultipart(request, config.maxImportBytes);
    return reply.code(201).send(imports.commit(upload.buffer, upload.fileName, upload.projectId));
  });

  app.get("/api/imports/:id", async (request) => imports.get(z.object({ id: z.string().min(1) }).parse(request.params).id));

  app.get("/api/phrases", async (request) => library.listPhrases(phraseQuery(request.query)));
  app.patch("/api/phrases/:id", async (request) => library.patchPhrase(
    z.object({ id: z.string().min(1) }).parse(request.params).id,
    extendedPhrasePatchSchema.parse(request.body),
  ));
  app.post("/api/phrases/:id/review", async (request) => {
    const id = z.object({ id: z.string().min(1) }).parse(request.params).id;
    const body = reviewDecisionSchema.parse(request.body);
    return library.reviewPhrase(id, body.decision, body.takeId);
  });
  app.post("/api/phrases/:id/approve", async (request) => library.reviewPhrase(z.object({ id: z.string() }).parse(request.params).id, "kept"));
  app.post("/api/phrases/:id/reject", async (request) => library.reviewPhrase(z.object({ id: z.string() }).parse(request.params).id, "discarded"));
  app.post("/api/phrases/bulk-review", async (request) => {
    const body = bulkReviewSchema.parse(request.body);
    return library.bulkReview(body.phraseIds, body.decision);
  });

  app.get("/api/review", async (request) => library.reviewQueue({ ...phraseQuery(request.query), hasAudio: true }));

  app.get("/api/audio/:takeId", async (request, reply) => {
    const takeId = z.object({ takeId: z.string().min(1) }).parse(request.params).takeId;
    const take = database.sqlite.prepare("SELECT file_path, mime_type FROM audio_takes WHERE id = ?").get(takeId) as { file_path: string; mime_type: string } | undefined;
    if (!take) throw notFound("Audio take");
    const root = resolve(config.audioRoot);
    const absolutePath = resolve(root, take.file_path);
    if (absolutePath !== root && !absolutePath.startsWith(`${root}${sep}`)) throw new AppError(500, "UNSAFE_AUDIO_PATH", "The stored audio path is invalid.");
    return sendAudioRange(reply, absolutePath, take.mime_type, request.headers.range);
  });

  app.post("/api/audio/:takeId/review", async (request) => {
    const takeId = z.object({ takeId: z.string().min(1) }).parse(request.params).takeId;
    const body = reviewTakeSchema.parse(request.body);
    const status = takeReviewStatus(body);
    const result = library.reviewTake(takeId, status, body.notes);
    if (body.decision === "kept" || body.decision === "discarded") {
      return library.reviewPhrase(String(result.id), body.decision, body.decision === "kept" ? takeId : undefined);
    }
    return result;
  });

  app.post("/api/phrases/:id/regenerate", async (request, reply) => {
    const id = z.object({ id: z.string().min(1) }).parse(request.params).id;
    const body = regenerationSchema.parse(request.body ?? {});
    return reply.code(202).send(queue.regenerate(id, body.seed));
  });
  app.post("/api/audio/:takeId/regenerate", async (request, reply) => {
    const takeId = z.object({ takeId: z.string().min(1) }).parse(request.params).takeId;
    const take = database.sqlite.prepare("SELECT phrase_id FROM audio_takes WHERE id = ?").get(takeId) as { phrase_id: string } | undefined;
    if (!take) throw notFound("Audio take");
    const body = regenerationSchema.parse(request.body ?? {});
    return reply.code(202).send(queue.regenerate(take.phrase_id, body.seed));
  });

  app.get("/api/voice-profiles", async (request) => ({ profiles: profiles.list(projectQuerySchema.parse(request.query).projectId) }));
  app.post("/api/voice-profiles", async (request, reply) => reply.code(201).send(profiles.create(profileInputSchema.parse(request.body))));
  app.post("/api/voice-profiles/:id/lock", async (request) => profiles.lock(z.object({ id: z.string().min(1) }).parse(request.params).id));
  app.post("/api/voice-profiles/:id/duplicate", async (request, reply) => reply.code(201).send(profiles.duplicate(z.object({ id: z.string().min(1) }).parse(request.params).id)));

  app.get("/api/voices/account", async (request) => {
    const query = z.object({
      search: z.string().trim().max(200).optional(),
      pageSize: z.coerce.number().int().min(1).max(100).default(50),
      nextPageToken: z.string().optional(),
      voiceType: z.string().optional(),
      category: z.string().optional(),
    }).parse(request.query);
    return provider.listAccountVoices(query);
  });

  app.get("/api/voices/shared", async (request) => {
    const query = sharedVoiceQuerySchema.parse(request.query);
    const { useCase, useCases, descriptive, descriptives, ...filters } = query;
    return elevenLabsProvider.listSharedVoices({
      ...filters,
      ...((useCase?.length || useCases?.length) ? { useCases: [...(useCase ?? []), ...(useCases ?? [])] } : {}),
      ...((descriptive?.length || descriptives?.length) ? { descriptives: [...(descriptive ?? []), ...(descriptives ?? [])] } : {}),
    });
  });

  app.get("/api/voices/shared/preview", async (request, reply) => {
    const query = z.object({ url: z.string().trim().min(1).max(3_000) }).strict().parse(request.query);
    const preview = await elevenLabsProvider.fetchSharedVoicePreview(query.url, request.headers.range);
    reply
      .code(preview.status)
      .header("content-type", preview.mimeType)
      .header("x-content-type-options", "nosniff")
      .header("content-length", preview.audio.byteLength)
      .header("cache-control", "no-store");
    if (preview.acceptRanges) reply.header("accept-ranges", preview.acceptRanges);
    if (preview.contentRange) reply.header("content-range", preview.contentRange);
    return reply.send(Buffer.from(preview.audio));
  });

  app.post("/api/voices/shared/:publicOwnerId/:voiceId/add", async (request) => {
    if (!config.elevenLabsApiKey) {
      throw new AppError(400, "ELEVENLABS_NOT_CONFIGURED", "Adding a Shared Voice requires ELEVENLABS_API_KEY in the server environment.");
    }
    const { publicOwnerId, voiceId } = sharedVoiceIdSchema.parse(request.params);
    const body = addSharedVoiceInputSchema.parse(request.body ?? {});
    return elevenLabsProvider.addSharedVoice(publicOwnerId, voiceId, {
      newName: body.newName ?? `Shared ${voiceId.slice(0, 12)}`,
      ...(body.bookmarked !== undefined ? { bookmarked: body.bookmarked } : {}),
    });
  });

  app.post("/api/providers/elevenlabs/test", async () => {
    const result = await elevenLabsProvider.testConnection();
    return { ...result, configured: Boolean(config.elevenLabsApiKey), key: maskedSecret(config.elevenLabsApiKey) };
  });

  app.get("/api/usage/summary", async () => {
    const local = database.sqlite.prepare(`
      SELECT COALESCE(SUM(estimated_units), 0) AS estimated, COALESCE(SUM(actual_units), 0) AS actual,
        COUNT(*) AS requests FROM usage_events WHERE provider = ?
    `).get(provider.name) as { estimated: number; actual: number; requests: number };
    let remote: unknown = null;
    let providerError: unknown = null;
    try { remote = await provider.getUsage(); } catch (error) {
      providerError = error instanceof AppError ? error.apiError : { code: "USAGE_UNAVAILABLE", message: "Provider usage is unavailable.", retryable: true };
    }
    const remoteRecord = remote && typeof remote === "object" ? remote as Record<string, unknown> : {};
    return {
      provider: provider.name,
      configured: provider.name === "mock" || Boolean(config.elevenLabsApiKey),
      local,
      remote,
      providerError,
      usedCharacters: remoteRecord.used ?? local.actual,
      includedCharacters: remoteRecord.limit ?? null,
      remainingCharacters: remoteRecord.remaining ?? null,
      periodEndsAt: remoteRecord.resetsAt ?? null,
      totalRequests: local.requests,
    };
  });

  app.get("/api/settings", async () => ({
    preferences: readSettings(database),
    provider: { mode: provider.name, elevenLabsConfigured: Boolean(config.elevenLabsApiKey), elevenLabsKey: maskedSecret(config.elevenLabsApiKey) },
    limits: {
      concurrency: config.concurrency,
      clipsPerBatch: config.maxClipsPerBatch,
      charactersPerBatch: config.maxCharactersPerBatch,
      importBytes: config.maxImportBytes,
      importRows: config.maxImportRows,
    },
  }));
  app.patch("/api/settings", async (request) => {
    const patch = settingsPatchSchema.parse(request.body);
    const statement = database.sqlite.prepare(`
      INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `);
    const now = new Date().toISOString();
    database.sqlite.transaction(() => {
      for (const [key, value] of Object.entries(patch)) statement.run(key, JSON.stringify(value), now);
    })();
    return { preferences: readSettings(database) };
  });

  app.post("/api/tts/preflight", async (request) => queue.preflight(preflightSchema.parse(request.body)));
  app.post("/api/tts/batches", async (request, reply) => {
    const body = batchRequestSchema.parse(request.body);
    return reply.code(202).send(queue.createBatch(body));
  });
  app.get("/api/tts/batches", async (request) => {
    const query = z.object({ projectId: z.string().min(1).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(request.query);
    return { batches: queue.listBatches(query.projectId, query.limit) };
  });
  app.get("/api/tts/batches/:id", async (request) => queue.getBatch(z.object({ id: z.string().min(1) }).parse(request.params).id));
  app.post("/api/tts/batches/:id/cancel", async (request) => queue.cancelBatch(z.object({ id: z.string().min(1) }).parse(request.params).id));
  app.post("/api/tts/batches/:id/retry", async (request) => queue.retryBatch(z.object({ id: z.string().min(1) }).parse(request.params).id));
  app.post("/api/tts/jobs/:id/retry", async (request) => queue.retryJob(z.object({ id: z.string().min(1) }).parse(request.params).id));

  app.post("/api/exports/preview", async (request) => {
    const body = exportRequestSchema.parse(request.body);
    return exportService.preview(body.projectId);
  });
  const createExport = async (request: { body: unknown }, reply: FastifyReply): Promise<FastifyReply> => {
    const body = exportRequestSchema.parse(request.body);
    return reply.code(201).send(await exportService.create(body.projectId, body.label));
  };
  app.post("/api/exports", createExport);
  app.post("/api/exports/create", createExport);
  app.get("/api/exports", async (request) => ({ exports: exportService.list(projectQuerySchema.parse(request.query).projectId) }));
  app.get("/api/exports/:id/download", async (request, reply) => {
    const id = z.object({ id: z.string().min(1) }).parse(request.params).id;
    const download = exportService.download(id);
    return reply
      .header("content-type", "application/zip")
      .header("content-length", download.byteSize)
      .header("content-disposition", `attachment; filename="${download.fileName.replaceAll('"', '')}"`)
      .send(download.stream);
  });
}
