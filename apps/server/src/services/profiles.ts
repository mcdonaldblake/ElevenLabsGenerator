import { createId, type VoiceSettings } from "@voice-foundry/domain";
import type { DatabaseContext } from "../db/client.js";
import { AppError, notFound } from "../errors.js";
import type { TtsProvider } from "../providers/index.js";

export type CreateProfileInput = {
  projectId: string;
  label: string;
  voiceId: string;
  voiceName: string;
  modelId: string;
  languageCode: string | null;
  outputFormat: string;
  settings: VoiceSettings;
  notes?: string | undefined;
};

function mapProfile(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    projectId: row.project_id,
    label: row.label,
    provider: row.provider,
    version: row.version,
    voiceId: row.voice_id,
    voiceName: row.voice_name,
    modelId: row.model_id,
    languageCode: row.language_code,
    outputFormat: row.output_format,
    settings: {
      stability: row.stability,
      similarityBoost: row.similarity_boost,
      style: row.style,
      speed: row.speed,
      useSpeakerBoost: Boolean(row.use_speaker_boost),
    },
    notes: row.notes,
    locked: Boolean(row.locked_at),
    lockedAt: row.locked_at,
    isProduction: Boolean(row.is_production),
    createdAt: row.created_at,
  };
}

export class ProfileService {
  constructor(
    private readonly database: DatabaseContext,
    private readonly activeProvider: TtsProvider["name"],
  ) {}

  list(projectId?: string): Record<string, unknown>[] {
    const rows = projectId
      ? this.database.sqlite.prepare("SELECT * FROM voice_profile_versions WHERE project_id = ? ORDER BY version DESC").all(projectId)
      : this.database.sqlite.prepare("SELECT * FROM voice_profile_versions ORDER BY created_at DESC").all();
    return (rows as Array<Record<string, unknown>>).map(mapProfile);
  }

  create(input: CreateProfileInput, provider: string = this.activeProvider): Record<string, unknown> {
    if (!this.database.sqlite.prepare("SELECT 1 FROM projects WHERE id = ?").get(input.projectId)) throw notFound("Project");
    const version = (this.database.sqlite.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS value FROM voice_profile_versions WHERE project_id = ?").get(input.projectId) as { value: number }).value;
    const id = createId("profile");
    const now = new Date().toISOString();
    this.database.sqlite.prepare(`
      INSERT INTO voice_profile_versions (
        id, project_id, label, provider, version, voice_id, voice_name, model_id,
        language_code, output_format, stability, similarity_boost, style, speed,
        use_speaker_boost, notes, locked_at, is_production, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?)
    `).run(
      id, input.projectId, input.label, provider, version, input.voiceId, input.voiceName,
      input.modelId, input.languageCode, input.outputFormat, input.settings.stability,
      input.settings.similarityBoost, input.settings.style, input.settings.speed,
      input.settings.useSpeakerBoost ? 1 : 0, input.notes ?? "", now,
    );
    return this.get(id);
  }

  get(id: string): Record<string, unknown> {
    const row = this.database.sqlite.prepare("SELECT * FROM voice_profile_versions WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) throw notFound("Voice profile");
    return mapProfile(row);
  }

  lock(id: string): Record<string, unknown> {
    const profile = this.database.sqlite.prepare("SELECT project_id, locked_at FROM voice_profile_versions WHERE id = ?").get(id) as { project_id: string; locked_at: string | null } | undefined;
    if (!profile) throw notFound("Voice profile");
    const now = profile.locked_at ?? new Date().toISOString();
    this.database.sqlite.transaction(() => {
      this.database.sqlite.prepare("UPDATE voice_profile_versions SET is_production = 0 WHERE project_id = ? AND id != ?").run(profile.project_id, id);
      this.database.sqlite.prepare("UPDATE voice_profile_versions SET locked_at = COALESCE(locked_at, ?), is_production = 1 WHERE id = ?").run(now, id);
    })();
    return this.get(id);
  }

  duplicate(id: string): Record<string, unknown> {
    const row = this.database.sqlite.prepare("SELECT * FROM voice_profile_versions WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) throw notFound("Voice profile");
    if (!row.locked_at) throw new AppError(409, "PROFILE_NOT_LOCKED", "Only a locked profile needs to be duplicated; create or use the existing draft instead.");
    return this.create({
      projectId: String(row.project_id),
      label: `${String(row.label)} (draft)`,
      voiceId: String(row.voice_id),
      voiceName: String(row.voice_name),
      modelId: String(row.model_id),
      languageCode: row.language_code == null ? null : String(row.language_code),
      outputFormat: String(row.output_format),
      settings: {
        stability: Number(row.stability),
        similarityBoost: Number(row.similarity_boost),
        style: Number(row.style),
        speed: Number(row.speed),
        useSpeakerBoost: Boolean(row.use_speaker_boost),
      },
      notes: String(row.notes),
    }, String(row.provider));
  }
}
