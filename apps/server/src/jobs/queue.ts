import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomInt } from "node:crypto";
import { createId, jobFingerprint, safePathSegment, sha256, type VoiceSettings } from "@voice-foundry/domain";
import type { ServerConfig } from "../config.js";
import type { DatabaseContext } from "../db/client.js";
import { AppError, notFound } from "../errors.js";
import { redactSecrets } from "../logger.js";
import { ProviderError, type TtsProvider } from "../providers/index.js";

export type BatchMode = "calibration" | "first_pass" | "regeneration";

export type BatchRequest = {
  projectId: string;
  voiceProfileVersionId: string;
  phraseIds?: string[] | undefined;
  mode: BatchMode;
  missingOnly?: boolean | undefined;
  limit?: number | undefined;
};

type PhraseRow = {
  id: string;
  stable_id: string;
  display_text: string;
  synthesis_text: string | null;
};

type ProfileRow = {
  id: string;
  project_id: string;
  provider: string;
  voice_id: string;
  voice_name: string;
  model_id: string;
  output_format: string;
  language_code: string | null;
  stability: number;
  similarity_boost: number;
  style: number;
  speed: number;
  use_speaker_boost: number;
  locked_at: string | null;
};

type JobRow = {
  id: string;
  batch_id: string;
  project_id: string;
  phrase_id: string;
  voice_profile_version_id: string;
  provider: string;
  fingerprint: string;
  synthesis_text: string;
  voice_id: string;
  model_id: string;
  output_format: string;
  language_code: string | null;
  settings_json: string;
  seed: number;
  attempt_count: number;
  max_attempts: number;
};

type Recipe = {
  phrase: PhraseRow;
  text: string;
  settings: VoiceSettings;
  seed: number;
  fingerprint: string;
  existingTakeId: string | null;
  activeJobId: string | null;
};

type RecipeSelection = {
  missingOnly: boolean;
  requestedLimit: number | null;
  selectedCount: number;
  remainingCount: number;
  inFlightCount: number;
  totalMissingCount: number;
};

function profileSettings(profile: ProfileRow): VoiceSettings {
  return {
    stability: profile.stability,
    similarityBoost: profile.similarity_boost,
    style: profile.style,
    speed: profile.speed,
    useSpeakerBoost: Boolean(profile.use_speaker_boost),
  };
}

function stableSeed(phraseId: string, profileId: string): number {
  return Number.parseInt(sha256(`${phraseId}:${profileId}`).slice(0, 8), 16) % 2_147_483_647;
}

function safeJson(value: string | null): unknown {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

export class TtsQueue {
  private timer: NodeJS.Timeout | null = null;
  private active = new Map<string, Promise<void>>();
  private activeConcurrency: number;
  private stopped = false;

  constructor(
    private readonly database: DatabaseContext,
    private readonly provider: TtsProvider,
    private readonly config: ServerConfig,
  ) {
    this.activeConcurrency = config.concurrency;
  }

  recover(): void {
    const now = new Date().toISOString();
    this.database.sqlite.prepare(`
      UPDATE tts_jobs SET status = 'queued', started_at = NULL, available_at = ?, updated_at = ?
      WHERE status = 'running' AND provider = ?
    `).run(now, now, this.provider.name);
    this.database.sqlite.prepare(`
      UPDATE tts_batches SET status = 'paused_provider', updated_at = ?, completed_at = NULL
      WHERE status IN ('queued', 'running') AND EXISTS (
        SELECT 1 FROM tts_jobs
        WHERE tts_jobs.batch_id = tts_batches.id
          AND tts_jobs.status IN ('queued', 'retry_wait', 'running')
          AND tts_jobs.provider != ?
      )
    `).run(now, this.provider.name);
    this.database.sqlite.prepare(`
      UPDATE tts_batches SET status = 'running', updated_at = ?
      WHERE status IN ('queued', 'running', 'paused_provider') AND EXISTS (
        SELECT 1 FROM tts_jobs WHERE tts_jobs.batch_id = tts_batches.id
          AND tts_jobs.status IN ('queued', 'retry_wait', 'running')
          AND tts_jobs.provider = ?
      ) AND NOT EXISTS (
        SELECT 1 FROM tts_jobs WHERE tts_jobs.batch_id = tts_batches.id
          AND tts_jobs.status IN ('queued', 'retry_wait', 'running')
          AND tts_jobs.provider != ?
      )
    `).run(now, this.provider.name, this.provider.name);
  }

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.recover();
    this.timer = setInterval(() => this.pump(), 150);
    this.timer.unref();
    this.pump();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await Promise.allSettled(this.active.values());
  }

  private getProfile(projectId: string, profileId: string): ProfileRow {
    const profile = this.database.sqlite.prepare(`
      SELECT * FROM voice_profile_versions WHERE id = ? AND project_id = ?
    `).get(profileId, projectId) as ProfileRow | undefined;
    if (!profile) throw notFound("Voice profile");
    if (!profile.locked_at) throw new AppError(409, "VOICE_PROFILE_NOT_LOCKED", "Lock the voice profile before generating a batch.");
    if (profile.provider !== this.provider.name) {
      throw new AppError(409, "VOICE_PROFILE_PROVIDER_MISMATCH", `This profile belongs to ${profile.provider}; the active TTS provider is ${this.provider.name}. Create and lock a profile for the active provider.`);
    }
    return profile;
  }

  private selectPhrases(request: BatchRequest): PhraseRow[] {
    const selectedIds = request.phraseIds ? [...new Set(request.phraseIds)] : null;
    let phrases: PhraseRow[];
    if (selectedIds) {
      if (selectedIds.length === 0) return [];
      const placeholders = selectedIds.map(() => "?").join(",");
      phrases = this.database.sqlite.prepare(`
        SELECT id, stable_id, display_text, synthesis_text FROM phrases
        WHERE project_id = ? AND decision != 'discarded' AND id IN (${placeholders})
        ORDER BY created_at, COALESCE(import_id, ''), source_row, id
      `).all(request.projectId, ...selectedIds) as PhraseRow[];
      if (phrases.length !== selectedIds.length) {
        throw new AppError(400, "PHRASES_NOT_GENERATABLE", "Every selected phrase must exist in the project and not be discarded.", {
          details: { requested: selectedIds.length, eligible: phrases.length },
        });
      }
    } else {
      phrases = this.database.sqlite.prepare(`
        SELECT id, stable_id, display_text, synthesis_text FROM phrases
        WHERE project_id = ? AND decision != 'discarded'
        ORDER BY created_at, COALESCE(import_id, ''), source_row, id
      `).all(request.projectId) as PhraseRow[];
    }
    if (request.mode === "calibration" && !selectedIds) return phrases.slice(0, 20);
    return phrases;
  }

  private recipes(request: BatchRequest, forceSeeds?: Map<string, number>): {
    profile: ProfileRow;
    recipes: Recipe[];
    selection: RecipeSelection;
  } {
    if (request.missingOnly && request.mode !== "first_pass") {
      throw new AppError(400, "MISSING_ONLY_MODE", "Recipe-aware missing selection is available only for first-pass batches.");
    }
    if (request.missingOnly && request.phraseIds) {
      throw new AppError(400, "AMBIGUOUS_TTS_SELECTION", "Use either phraseIds or recipe-aware missing selection, not both.");
    }
    if (request.limit != null && !request.missingOnly) {
      throw new AppError(400, "TTS_LIMIT_REQUIRES_MISSING_ONLY", "A batch selection limit requires missingOnly=true.");
    }
    if (request.limit != null && request.limit > this.config.maxClipsPerBatch) {
      throw new AppError(400, "TTS_SELECTION_LIMIT", `The selection limit cannot exceed ${this.config.maxClipsPerBatch}.`);
    }
    const profile = this.getProfile(request.projectId, request.voiceProfileVersionId);
    const settings = profileSettings(profile);
    const phrases = this.selectPhrases(request);
    const successful = this.database.sqlite.prepare(`
      SELECT audio_takes.id AS take_id
      FROM tts_jobs JOIN audio_takes ON audio_takes.job_id = tts_jobs.id
      WHERE tts_jobs.fingerprint = ? AND tts_jobs.provider = ? AND audio_takes.provider = ?
        AND tts_jobs.status = 'succeeded'
      ORDER BY audio_takes.created_at DESC LIMIT 1
    `);
    const inFlight = this.database.sqlite.prepare(`
      SELECT id FROM tts_jobs
      WHERE fingerprint = ? AND provider = ? AND status IN ('queued', 'retry_wait', 'running')
      ORDER BY created_at LIMIT 1
    `);
    const allRecipes = phrases.map((phrase) => {
        const text = phrase.synthesis_text || phrase.display_text;
        const seed = forceSeeds?.get(phrase.id) ?? stableSeed(phrase.id, profile.id);
        const recipeFingerprint = jobFingerprint({
          synthesisText: text,
          voiceProfileVersionId: profile.id,
          voiceId: profile.voice_id,
          modelId: profile.model_id,
          outputFormat: profile.output_format,
          languageCode: profile.language_code,
          settings,
          seed,
        });
        const fingerprint = sha256(JSON.stringify({ provider: this.provider.name, recipeFingerprint }));
        const prior = successful.get(fingerprint, this.provider.name, this.provider.name) as { take_id: string } | undefined;
        const active = prior ? undefined : inFlight.get(fingerprint, this.provider.name) as { id: string } | undefined;
        return {
          phrase,
          text,
          settings,
          seed,
          fingerprint,
          existingTakeId: prior?.take_id ?? null,
          activeJobId: active?.id ?? null,
        };
      });
    if (!request.missingOnly) {
      return {
        profile,
        recipes: allRecipes,
        selection: {
          missingOnly: false,
          requestedLimit: null,
          selectedCount: allRecipes.length,
          remainingCount: 0,
          inFlightCount: allRecipes.filter((recipe) => recipe.activeJobId).length,
          totalMissingCount: allRecipes.filter((recipe) => !recipe.existingTakeId).length,
        },
      };
    }
    const requestedLimit = request.limit ?? this.config.maxClipsPerBatch;
    const availableMissing = allRecipes.filter((recipe) => !recipe.existingTakeId && !recipe.activeJobId);
    const inFlightCount = allRecipes.filter((recipe) => !recipe.existingTakeId && recipe.activeJobId).length;
    const selected = availableMissing.slice(0, requestedLimit);
    return {
      profile,
      recipes: selected,
      selection: {
        missingOnly: true,
        requestedLimit,
        selectedCount: selected.length,
        remainingCount: Math.max(0, availableMissing.length - selected.length),
        inFlightCount,
        totalMissingCount: availableMissing.length + inFlightCount,
      },
    };
  }

  preflight(request: BatchRequest): Record<string, unknown> {
    const { profile, recipes, selection } = this.recipes(request);
    const totalTextCharacters = recipes.reduce((sum, recipe) => sum + recipe.text.length, 0);
    const totalCharacters = recipes.filter((recipe) => !recipe.existingTakeId).reduce((sum, recipe) => sum + recipe.text.length, 0);
    const reusedJobs = recipes.filter((recipe) => recipe.existingTakeId).length;
    const newJobs = recipes.length - reusedJobs;
    const inFlightJobs = recipes.filter((recipe) => recipe.activeJobId).length;
    const blockingReasons: string[] = [];
    if (recipes.length === 0) {
      blockingReasons.push(request.missingOnly
        ? "No missing exact-recipe phrases are currently available for this chunk."
        : "No eligible non-discarded phrases match this request.");
    }
    if (request.mode === "first_pass" && !this.hasApprovedCalibration(request.voiceProfileVersionId)) {
      blockingReasons.push("Approve at least one take from a successful calibration batch before starting a first-pass batch.");
    }
    if (inFlightJobs > 0) blockingReasons.push(`${inFlightJobs} identical generation request(s) are already queued or running.`);
    if (newJobs > this.config.maxClipsPerBatch) blockingReasons.push(`New clip count exceeds the configured limit of ${this.config.maxClipsPerBatch}.`);
    if (totalCharacters > this.config.maxCharactersPerBatch) blockingReasons.push(`Character count exceeds the configured limit of ${this.config.maxCharactersPerBatch}.`);
    return {
      projectId: request.projectId,
      voiceProfileVersionId: profile.id,
      provider: this.provider.name,
      mode: request.mode,
      phraseCount: recipes.length,
      newJobs,
      reusedJobs,
      inFlightJobs,
      totalCharacters,
      totalTextCharacters,
      estimatedUnits: totalCharacters,
      limits: { clips: this.config.maxClipsPerBatch, characters: this.config.maxCharactersPerBatch },
      allowed: blockingReasons.length === 0,
      blockingReasons,
      selection,
    };
  }

  createBatch(request: BatchRequest, options: { forceSeeds?: Map<string, number> } = {}): Record<string, unknown> {
    const preflight = this.preflightWithSeeds(request, options.forceSeeds);
    if (!preflight.allowed) {
      throw new AppError(409, "TTS_BATCH_BLOCKED", "The batch cannot be created.", { details: { blockingReasons: preflight.blockingReasons } });
    }
    const { profile, recipes, selection } = this.recipes(request, options.forceSeeds);
    const batchId = createId("batch");
    const now = new Date().toISOString();
    const totalCharacters = recipes.filter((recipe) => !recipe.existingTakeId).reduce((sum, recipe) => sum + recipe.text.length, 0);
    const reused = recipes.filter((recipe) => recipe.existingTakeId).length;
    const insertJob = this.database.sqlite.prepare(`
      INSERT INTO tts_jobs (
        id, batch_id, project_id, phrase_id, voice_profile_version_id, fingerprint,
        provider, status, synthesis_text, voice_id, model_id, output_format, language_code,
        settings_json, seed, attempt_count, max_attempts, available_at, reused_take_id,
        completed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
    `);
    this.database.sqlite.transaction(() => {
      const collision = recipes.find((recipe) => !recipe.existingTakeId && this.database.sqlite.prepare(`
        SELECT 1 FROM tts_jobs WHERE fingerprint = ? AND provider = ? AND status IN ('queued', 'retry_wait', 'running') LIMIT 1
      `).get(recipe.fingerprint, this.provider.name));
      if (collision) {
        throw new AppError(409, "TTS_FINGERPRINT_IN_FLIGHT", "An identical generation request is already queued or running.");
      }
      this.database.sqlite.prepare(`
        INSERT INTO tts_batches (
          id, project_id, voice_profile_version_id, mode, status, total_jobs,
          completed_jobs, failed_jobs, canceled_jobs, total_characters,
          created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)
      `).run(
        batchId, request.projectId, profile.id, request.mode,
        reused === recipes.length ? "succeeded" : "running",
        recipes.length, reused, totalCharacters, now, now,
        reused === recipes.length ? now : null,
      );
      for (const recipe of recipes) {
        const isReused = Boolean(recipe.existingTakeId);
        insertJob.run(
          createId("job"), batchId, request.projectId, recipe.phrase.id, profile.id, recipe.fingerprint,
          this.provider.name, isReused ? "succeeded" : "queued", recipe.text, profile.voice_id, profile.model_id,
          profile.output_format, profile.language_code, JSON.stringify(recipe.settings), recipe.seed,
          this.config.queueMaxAttempts, now, recipe.existingTakeId, isReused ? now : null, now, now,
        );
      }
    })();
    this.pump();
    return { ...this.getBatch(batchId), selection };
  }

  private preflightWithSeeds(request: BatchRequest, seeds?: Map<string, number>): {
    allowed: boolean;
    blockingReasons: string[];
  } {
    const { recipes } = this.recipes(request, seeds);
    const newJobs = recipes.filter((recipe) => !recipe.existingTakeId).length;
    const characters = recipes.filter((recipe) => !recipe.existingTakeId).reduce((sum, recipe) => sum + recipe.text.length, 0);
    const blockingReasons: string[] = [];
    if (recipes.length === 0) blockingReasons.push(request.missingOnly
      ? "No missing exact-recipe phrases are currently available for this chunk."
      : "No eligible non-discarded phrases match this request.");
    if (request.mode === "first_pass" && !this.hasApprovedCalibration(request.voiceProfileVersionId)) {
      blockingReasons.push("Approve at least one take from a successful calibration batch before starting a first-pass batch.");
    }
    if (recipes.some((recipe) => recipe.activeJobId)) blockingReasons.push("An identical generation request is already queued or running.");
    if (newJobs > this.config.maxClipsPerBatch) blockingReasons.push(`New clip count exceeds ${this.config.maxClipsPerBatch}.`);
    if (characters > this.config.maxCharactersPerBatch) blockingReasons.push(`Character count exceeds ${this.config.maxCharactersPerBatch}.`);
    return { allowed: blockingReasons.length === 0, blockingReasons };
  }

  regenerate(phraseId: string, seed?: number): Record<string, unknown> {
    const phrase = this.database.sqlite.prepare(`
      SELECT project_id FROM phrases WHERE id = ? AND decision != 'discarded'
    `).get(phraseId) as { project_id: string } | undefined;
    if (!phrase) throw new AppError(400, "PHRASE_NOT_GENERATABLE", "The phrase must exist and not be discarded before regeneration.");
    const profile = this.database.sqlite.prepare(`
      SELECT id FROM voice_profile_versions WHERE project_id = ? AND locked_at IS NOT NULL AND is_production = 1
      ORDER BY version DESC LIMIT 1
    `).get(phrase.project_id) as { id: string } | undefined;
    if (!profile) throw new AppError(409, "NO_PRODUCTION_PROFILE", "Lock a production voice profile before regeneration.");
    const chosenSeed = seed ?? randomInt(0, 2_147_483_647);
    return this.createBatch({
      projectId: phrase.project_id,
      voiceProfileVersionId: profile.id,
      phraseIds: [phraseId],
      mode: "regeneration",
    }, { forceSeeds: new Map([[phraseId, chosenSeed]]) });
  }

  getBatch(id: string): Record<string, unknown> {
    const batch = this.database.sqlite.prepare("SELECT * FROM tts_batches WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!batch) throw notFound("TTS batch");
    const jobs = this.database.sqlite.prepare(`
      SELECT tts_jobs.*, phrases.display_text, phrases.stable_id, audio_takes.id AS take_id
      FROM tts_jobs
      JOIN phrases ON phrases.id = tts_jobs.phrase_id
      LEFT JOIN audio_takes ON audio_takes.job_id = tts_jobs.id
      WHERE tts_jobs.batch_id = ? ORDER BY tts_jobs.created_at, tts_jobs.id
    `).all(id) as Array<Record<string, unknown>>;
    const queueCounts = jobs.reduce<{ queuedJobs: number; runningJobs: number }>((counts, job) => {
      const status = String(job.status);
      if (status === "queued" || status === "retry_wait") counts.queuedJobs += 1;
      if (status === "running") counts.runningJobs += 1;
      return counts;
    }, { queuedJobs: 0, runningJobs: 0 });
    return {
      id: batch.id,
      projectId: batch.project_id,
      voiceProfileVersionId: batch.voice_profile_version_id,
      mode: batch.mode,
      status: batch.status,
      totalJobs: batch.total_jobs,
      completedJobs: batch.completed_jobs,
      failedJobs: batch.failed_jobs,
      canceledJobs: batch.canceled_jobs,
      queuedJobs: queueCounts.queuedJobs,
      runningJobs: queueCounts.runningJobs,
      activeRequests: [...this.active.keys()].filter((jobId) => jobs.some((job) => job.id === jobId)).length,
      totalCharacters: batch.total_characters,
      createdAt: batch.created_at,
      updatedAt: batch.updated_at,
      completedAt: batch.completed_at,
      jobs: jobs.map((job) => ({
        id: job.id,
        phraseId: job.phrase_id,
        phraseText: job.display_text,
        stableId: job.stable_id,
        status: job.status,
        attemptCount: job.attempt_count,
        maxAttempts: job.max_attempts,
        seed: job.seed,
        takeId: job.take_id ?? job.reused_take_id ?? null,
        reused: Boolean(job.reused_take_id),
        error: safeJson(job.error_json as string | null),
        providerRequestId: job.provider_request_id,
      })),
    };
  }

  listBatches(projectId?: string, limit = 50): Record<string, unknown>[] {
    const rows = projectId
      ? this.database.sqlite.prepare("SELECT id FROM tts_batches WHERE project_id = ? ORDER BY created_at DESC LIMIT ?").all(projectId, limit)
      : this.database.sqlite.prepare("SELECT id FROM tts_batches ORDER BY created_at DESC LIMIT ?").all(limit);
    return (rows as Array<{ id: string }>).map((row) => this.getBatch(row.id));
  }

  cancelBatch(id: string): Record<string, unknown> {
    if (!this.database.sqlite.prepare("SELECT 1 FROM tts_batches WHERE id = ?").get(id)) throw notFound("TTS batch");
    const now = new Date().toISOString();
    this.database.sqlite.transaction(() => {
      this.database.sqlite.prepare(`
        UPDATE tts_jobs SET status = 'canceled', completed_at = ?, updated_at = ?
        WHERE batch_id = ? AND status IN ('queued', 'retry_wait')
      `).run(now, now, id);
      this.refreshBatch(id);
    })();
    return this.getBatch(id);
  }

  retryJob(id: string): Record<string, unknown> {
    const job = this.database.sqlite.prepare("SELECT batch_id, status, provider FROM tts_jobs WHERE id = ?").get(id) as { batch_id: string; status: string; provider: string } | undefined;
    if (!job) throw notFound("TTS job");
    if (job.provider !== this.provider.name) throw new AppError(409, "TTS_JOB_PROVIDER_MISMATCH", `This job belongs to ${job.provider}; activate that provider before retrying it.`);
    if (!['failed', 'canceled'].includes(job.status)) throw new AppError(409, "JOB_NOT_RETRYABLE", "Only failed or canceled jobs can be retried.");
    const now = new Date().toISOString();
    this.database.sqlite.transaction(() => {
      this.database.sqlite.prepare(`
        UPDATE tts_jobs SET status = 'queued', available_at = ?, completed_at = NULL,
        error_json = NULL, updated_at = ? WHERE id = ?
      `).run(now, now, id);
      this.database.sqlite.prepare("UPDATE tts_batches SET consecutive_failures = 0, updated_at = ? WHERE id = ?").run(now, job.batch_id);
      this.refreshBatch(job.batch_id);
    })();
    this.pump();
    return this.getBatch(job.batch_id);
  }

  retryBatch(id: string): Record<string, unknown> {
    if (!this.database.sqlite.prepare("SELECT 1 FROM tts_batches WHERE id = ?").get(id)) throw notFound("TTS batch");
    const mismatched = this.database.sqlite.prepare("SELECT provider FROM tts_jobs WHERE batch_id = ? AND provider != ? LIMIT 1").get(id, this.provider.name) as { provider: string } | undefined;
    if (mismatched) throw new AppError(409, "TTS_BATCH_PROVIDER_MISMATCH", `This batch belongs to ${mismatched.provider}; activate that provider before retrying it.`);
    const now = new Date().toISOString();
    this.database.sqlite.transaction(() => {
      this.database.sqlite.prepare(`
        UPDATE tts_jobs SET status = 'queued', available_at = ?, completed_at = NULL,
        error_json = NULL, updated_at = ? WHERE batch_id = ? AND status IN ('failed', 'canceled')
      `).run(now, now, id);
      this.database.sqlite.prepare("UPDATE tts_batches SET consecutive_failures = 0, updated_at = ? WHERE id = ?").run(now, id);
      this.refreshBatch(id);
    })();
    this.pump();
    return this.getBatch(id);
  }

  private claimNext(): JobRow | null {
    const now = new Date().toISOString();
    return this.database.sqlite.transaction(() => {
      const job = this.database.sqlite.prepare(`
        SELECT tts_jobs.* FROM tts_jobs JOIN tts_batches ON tts_batches.id = tts_jobs.batch_id
        WHERE tts_jobs.status IN ('queued', 'retry_wait') AND tts_jobs.available_at <= ?
          AND tts_jobs.provider = ?
          AND tts_batches.status IN ('queued', 'running')
        ORDER BY tts_jobs.available_at, tts_jobs.created_at LIMIT 1
      `).get(now, this.provider.name) as JobRow | undefined;
      if (!job) return null;
      const changed = this.database.sqlite.prepare(`
        UPDATE tts_jobs SET status = 'running', started_at = ?, attempt_count = attempt_count + 1, updated_at = ?
        WHERE id = ? AND status IN ('queued', 'retry_wait')
      `).run(now, now, job.id);
      if (changed.changes !== 1) return null;
      job.attempt_count += 1;
      return job;
    })();
  }

  private pump(): void {
    if (this.stopped) return;
    while (this.active.size < this.activeConcurrency) {
      const job = this.claimNext();
      if (!job) break;
      const task = this.run(job).finally(() => {
        this.active.delete(job.id);
        queueMicrotask(() => this.pump());
      });
      this.active.set(job.id, task);
    }
  }

  private async run(job: JobRow): Promise<void> {
    try {
      const result = await this.provider.synthesize({
        text: job.synthesis_text,
        voiceId: job.voice_id,
        modelId: job.model_id,
        outputFormat: job.output_format,
        languageCode: job.language_code,
        settings: JSON.parse(job.settings_json) as VoiceSettings,
        seed: job.seed,
      });
      const relativePath = join(
        safePathSegment(job.project_id),
        safePathSegment(job.voice_profile_version_id),
        safePathSegment(job.phrase_id),
        `${safePathSegment(job.id)}.${result.extension}`,
      );
      const targetPath = join(this.config.audioRoot, relativePath);
      const temporaryPath = `${targetPath}.partial`;
      await mkdir(join(targetPath, ".."), { recursive: true });
      await rm(temporaryPath, { force: true });
      await writeFile(temporaryPath, result.audio, { flag: "wx" });
      await rename(temporaryPath, targetPath);
      const now = new Date().toISOString();
      this.database.sqlite.transaction(() => {
        const number = this.database.sqlite.prepare("SELECT COALESCE(MAX(take_number), 0) + 1 AS value FROM audio_takes WHERE phrase_id = ?").get(job.phrase_id) as { value: number };
        const takeId = createId("take");
        this.database.sqlite.prepare(`
          INSERT INTO audio_takes (
            id, project_id, phrase_id, job_id, voice_profile_version_id, provider, take_number,
            file_path, mime_type, extension, byte_size, duration_ms, sha256, source,
            review_status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'tts', 'pending', ?, ?)
        `).run(
          takeId, job.project_id, job.phrase_id, job.id, job.voice_profile_version_id, job.provider,
          number.value, relativePath, result.mimeType, result.extension, result.audio.byteLength,
          result.durationMs, sha256(result.audio), now, now,
        );
        this.database.sqlite.prepare(`
          UPDATE tts_jobs SET status = 'succeeded', completed_at = ?, provider_request_id = ?,
          error_json = NULL, updated_at = ? WHERE id = ?
        `).run(now, result.providerRequestId, now, job.id);
        this.database.sqlite.prepare(`
          INSERT INTO usage_events (id, provider, operation, request_id, estimated_units, actual_units, model_id, job_id, metadata_json, created_at)
          VALUES (?, ?, 'text_to_speech', ?, ?, ?, ?, ?, '{}', ?)
        `).run(createId("usage"), this.provider.name, result.providerRequestId, job.synthesis_text.length, result.actualUnits, job.model_id, job.id, now);
        this.database.sqlite.prepare("UPDATE tts_batches SET consecutive_failures = 0 WHERE id = ?").run(job.batch_id);
        this.refreshBatch(job.batch_id);
      })();
    } catch (error) {
      await this.fail(job, error);
    }
  }

  private async fail(job: JobRow, error: unknown): Promise<void> {
    const now = new Date();
    const providerError = error instanceof ProviderError ? error : null;
    const retryable = providerError?.apiError.retryable ?? false;
    const retryDelay = providerError?.retryAfterMs ?? Math.min(60_000, 1_000 * 2 ** Math.max(0, job.attempt_count - 1) + randomInt(0, 500));
    const shouldRetry = retryable && job.attempt_count < job.max_attempts;
    const sanitized = error instanceof AppError
      ? error.apiError
      : { code: "TTS_JOB_ERROR", message: "The TTS job failed.", retryable: false, details: { cause: redactSecrets(error instanceof Error ? error.message : String(error), [this.config.elevenLabsApiKey]) } };
    if (providerError?.concurrencyLimited) this.activeConcurrency = Math.max(1, this.activeConcurrency - 1);
    const availableAt = new Date(now.getTime() + retryDelay).toISOString();
    const isoNow = now.toISOString();
    this.database.sqlite.transaction(() => {
      this.database.sqlite.prepare(`
        UPDATE tts_jobs SET status = ?, available_at = ?, completed_at = ?, error_json = ?,
          provider_request_id = ?, updated_at = ? WHERE id = ?
      `).run(
        shouldRetry ? "retry_wait" : "failed", availableAt, shouldRetry ? null : isoNow,
        JSON.stringify(sanitized), providerError?.apiError.providerRequestId ?? null, isoNow, job.id,
      );
      this.database.sqlite.prepare("UPDATE tts_batches SET consecutive_failures = consecutive_failures + 1 WHERE id = ?").run(job.batch_id);
      const batch = this.database.sqlite.prepare("SELECT consecutive_failures FROM tts_batches WHERE id = ?").get(job.batch_id) as { consecutive_failures: number };
      if (batch.consecutive_failures >= this.config.queueMaxConsecutiveFailures) {
        this.database.sqlite.prepare(`
          UPDATE tts_jobs SET status = 'canceled', completed_at = ?, updated_at = ?
          WHERE batch_id = ? AND status IN ('queued', 'retry_wait')
        `).run(isoNow, isoNow, job.batch_id);
      }
      this.refreshBatch(job.batch_id);
    })();
  }

  private refreshBatch(batchId: string): void {
    const counts = this.database.sqlite.prepare(`
      SELECT
        SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN status = 'canceled' THEN 1 ELSE 0 END) AS canceled,
        SUM(CASE WHEN status IN ('queued', 'retry_wait', 'running') THEN 1 ELSE 0 END) AS active,
        COUNT(*) AS total
      FROM tts_jobs WHERE batch_id = ?
    `).get(batchId) as { succeeded: number; failed: number; canceled: number; active: number; total: number };
    const now = new Date().toISOString();
    const status = counts.active > 0
      ? "running"
      : counts.failed === counts.total
        ? "failed"
        : counts.canceled === counts.total
          ? "canceled"
          : counts.failed > 0 || counts.canceled > 0
            ? "partial"
            : "succeeded";
    this.database.sqlite.prepare(`
      UPDATE tts_batches SET status = ?, completed_jobs = ?, failed_jobs = ?, canceled_jobs = ?,
        updated_at = ?, completed_at = ? WHERE id = ?
    `).run(status, counts.succeeded, counts.failed, counts.canceled, now, counts.active > 0 ? null : now, batchId);
  }

  private hasApprovedCalibration(profileId: string): boolean {
    return Boolean(this.database.sqlite.prepare(`
      SELECT 1
      FROM tts_batches
      JOIN tts_jobs ON tts_jobs.batch_id = tts_batches.id
      JOIN audio_takes ON audio_takes.job_id = tts_jobs.id OR audio_takes.id = tts_jobs.reused_take_id
      WHERE tts_batches.voice_profile_version_id = ?
        AND tts_batches.mode = 'calibration'
        AND tts_jobs.status = 'succeeded'
        AND audio_takes.review_status IN ('primary', 'alternate')
        AND tts_jobs.provider = ?
        AND audio_takes.provider = ?
        AND audio_takes.phrase_id = tts_jobs.phrase_id
        AND audio_takes.voice_profile_version_id = tts_jobs.voice_profile_version_id
        AND tts_jobs.synthesis_text = (
          SELECT COALESCE(phrases.synthesis_text, phrases.display_text)
          FROM phrases WHERE phrases.id = tts_jobs.phrase_id
        )
      LIMIT 1
    `).get(profileId, this.provider.name, this.provider.name));
  }
}
