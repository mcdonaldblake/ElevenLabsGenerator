import { createId, normalizePhrase, comparisonPhrase } from "@voice-foundry/domain";
import type { DatabaseContext } from "../db/client.js";
import { AppError, notFound } from "../errors.js";

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function phraseAudioStatus(row: Record<string, unknown>): string {
  const takeCount = Number(row.take_count ?? 0);
  const primaryCount = Number(row.primary_count ?? 0);
  const pendingCount = Number(row.pending_take_count ?? 0);
  if (primaryCount === 1) return "primary_selected";
  if (takeCount === 0) return "no_audio";
  if (pendingCount > 0) return "pending_review";
  return "reviewed_no_primary";
}

function mapPhrase(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    projectId: row.project_id,
    importId: row.import_id,
    stableId: row.stable_id,
    suppliedId: row.supplied_id,
    sourceRow: row.source_row,
    displayText: row.display_text,
    originalText: row.original_text,
    synthesisText: row.synthesis_text,
    groupCode: row.group_code,
    category: row.category,
    tone: row.tone,
    englishMeaning: row.english_meaning,
    notes: row.notes,
    metadata: parseJsonObject(row.metadata_json),
    decision: row.decision,
    selectedTakeId: row.selected_take_id,
    audioStatus: phraseAudioStatus(row),
    takeCount: Number(row.take_count ?? 0),
    primaryCount: Number(row.primary_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type PhraseQuery = {
  projectId: string;
  page: number;
  pageSize: number;
  search?: string | undefined;
  decision?: "pending" | "kept" | "discarded" | undefined;
  audioStatus?: "no_audio" | "pending_review" | "primary_selected" | "reviewed_no_primary" | undefined;
  hasAudio?: boolean | undefined;
};

export class LibraryService {
  constructor(private readonly database: DatabaseContext) {}

  listProjects(): Record<string, unknown>[] {
    const rows = this.database.sqlite.prepare(`
      SELECT projects.*,
        (SELECT COUNT(*) FROM phrases WHERE phrases.project_id = projects.id) AS phrase_count,
        (SELECT COUNT(*) FROM phrases WHERE phrases.project_id = projects.id AND decision = 'kept') AS kept_count,
        (SELECT COUNT(*) FROM phrases WHERE phrases.project_id = projects.id AND decision = 'discarded') AS discarded_count,
        (SELECT COUNT(*) FROM phrases WHERE phrases.project_id = projects.id AND decision = 'pending') AS pending_count,
        (SELECT COUNT(*) FROM audio_takes WHERE audio_takes.project_id = projects.id) AS audio_count
      FROM projects ORDER BY projects.updated_at DESC
    `).all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      phraseCount: row.phrase_count,
      keptCount: row.kept_count,
      discardedCount: row.discarded_count,
      pendingCount: row.pending_count,
      audioCount: row.audio_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  createProject(input: { name: string; description: string }): Record<string, unknown> {
    const id = createId("project");
    const now = new Date().toISOString();
    this.database.sqlite.prepare(`
      INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
    `).run(id, input.name, input.description, now, now);
    return this.listProjects().find((project) => project.id === id) ?? { id, ...input, createdAt: now, updatedAt: now };
  }

  dashboard(projectId?: string): Record<string, unknown> {
    const selectedId = projectId ?? (this.database.sqlite.prepare("SELECT id FROM projects ORDER BY updated_at DESC LIMIT 1").get() as { id: string } | undefined)?.id;
    if (!selectedId) {
      return {
        project: null,
        stats: { totalPhrases: 0, pending: 0, kept: 0, discarded: 0, audioTakes: 0, exportReady: 0 },
        queue: { queued: 0, running: 0, failed: 0 },
        recentImports: [],
        recentExports: [],
      };
    }
    const project = this.listProjects().find((item) => item.id === selectedId);
    if (!project) throw notFound("Project");
    const stats = this.database.sqlite.prepare(`
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN decision = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN decision = 'kept' THEN 1 ELSE 0 END) AS kept,
        SUM(CASE WHEN decision = 'discarded' THEN 1 ELSE 0 END) AS discarded,
        SUM(CASE WHEN decision = 'kept' AND EXISTS (
          SELECT 1 FROM audio_takes WHERE audio_takes.phrase_id = phrases.id AND review_status = 'primary'
        ) THEN 1 ELSE 0 END) AS export_ready
      FROM phrases WHERE project_id = ?
    `).get(selectedId) as Record<string, unknown>;
    const queue = this.database.sqlite.prepare(`
      SELECT
        SUM(CASE WHEN status IN ('queued', 'retry_wait') THEN 1 ELSE 0 END) AS queued,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
      FROM tts_jobs WHERE project_id = ?
    `).get(selectedId) as Record<string, unknown>;
    const audio = this.database.sqlite.prepare("SELECT COUNT(*) AS count FROM audio_takes WHERE project_id = ?").get(selectedId) as { count: number };
    const recentImports = this.database.sqlite.prepare("SELECT id, file_name, status, inserted_rows, created_at FROM imports WHERE project_id = ? ORDER BY created_at DESC LIMIT 5").all(selectedId) as Array<Record<string, unknown>>;
    const recentExports = this.database.sqlite.prepare("SELECT id, label, asset_count, created_at FROM exports WHERE project_id = ? ORDER BY created_at DESC LIMIT 5").all(selectedId) as Array<Record<string, unknown>>;
    const activeBatch = this.database.sqlite.prepare(`
      SELECT id, project_id, mode, status, total_jobs, completed_jobs, failed_jobs, total_characters, created_at, updated_at
      FROM tts_batches WHERE project_id = ? AND status IN ('queued', 'running')
      ORDER BY created_at DESC LIMIT 1
    `).get(selectedId) as Record<string, unknown> | undefined;
    return {
      project,
      stats: {
        totalPhrases: Number(stats.total ?? 0),
        pending: Number(stats.pending ?? 0),
        kept: Number(stats.kept ?? 0),
        discarded: Number(stats.discarded ?? 0),
        audioTakes: audio.count,
        exportReady: Number(stats.export_ready ?? 0),
      },
      counts: {
        imported: Number(stats.total ?? 0),
        totalPhrases: Number(stats.total ?? 0),
        pending: Number(stats.pending ?? 0),
        kept: Number(stats.kept ?? 0),
        discarded: Number(stats.discarded ?? 0),
        audioReady: audio.count,
        exportReady: Number(stats.export_ready ?? 0),
      },
      queue: { queued: Number(queue.queued ?? 0), running: Number(queue.running ?? 0), failed: Number(queue.failed ?? 0) },
      activeBatch: activeBatch ? {
        id: activeBatch.id,
        projectId: activeBatch.project_id,
        mode: activeBatch.mode,
        status: activeBatch.status,
        totalJobs: activeBatch.total_jobs,
        completedJobs: activeBatch.completed_jobs,
        failedJobs: activeBatch.failed_jobs,
        characters: activeBatch.total_characters,
        createdAt: activeBatch.created_at,
        updatedAt: activeBatch.updated_at,
      } : null,
      recentImports: recentImports.map((row) => ({ id: row.id, fileName: row.file_name, status: row.status, insertedRows: row.inserted_rows, createdAt: row.created_at })),
      recentExports: recentExports.map((row) => ({ id: row.id, label: row.label, assetCount: row.asset_count, createdAt: row.created_at })),
    };
  }

  listPhrases(query: PhraseQuery): Record<string, unknown> {
    if (!this.database.sqlite.prepare("SELECT 1 FROM projects WHERE id = ?").get(query.projectId)) throw notFound("Project");
    const conditions = ["phrases.project_id = ?"];
    const parameters: Array<string | number> = [query.projectId];
    if (query.search) {
      conditions.push(`(
        phrases.display_text LIKE ? ESCAPE '\\' OR phrases.stable_id LIKE ? ESCAPE '\\'
        OR phrases.group_code LIKE ? ESCAPE '\\' OR phrases.category LIKE ? ESCAPE '\\'
        OR phrases.tone LIKE ? ESCAPE '\\' OR phrases.english_meaning LIKE ? ESCAPE '\\'
        OR phrases.notes LIKE ? ESCAPE '\\'
      )`);
      const pattern = `%${escapeLike(query.search)}%`;
      parameters.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern);
    }
    if (query.decision) {
      conditions.push("phrases.decision = ?");
      parameters.push(query.decision);
    }
    if (query.hasAudio) conditions.push("EXISTS (SELECT 1 FROM audio_takes WHERE audio_takes.phrase_id = phrases.id)");
    if (query.audioStatus === "no_audio") conditions.push("NOT EXISTS (SELECT 1 FROM audio_takes WHERE audio_takes.phrase_id = phrases.id)");
    if (query.audioStatus === "pending_review") conditions.push("EXISTS (SELECT 1 FROM audio_takes WHERE audio_takes.phrase_id = phrases.id AND review_status = 'pending') AND NOT EXISTS (SELECT 1 FROM audio_takes WHERE audio_takes.phrase_id = phrases.id AND review_status = 'primary')");
    if (query.audioStatus === "primary_selected") conditions.push("EXISTS (SELECT 1 FROM audio_takes WHERE audio_takes.phrase_id = phrases.id AND review_status = 'primary')");
    if (query.audioStatus === "reviewed_no_primary") conditions.push("EXISTS (SELECT 1 FROM audio_takes WHERE audio_takes.phrase_id = phrases.id) AND NOT EXISTS (SELECT 1 FROM audio_takes WHERE audio_takes.phrase_id = phrases.id AND review_status IN ('pending', 'primary'))");
    const where = conditions.join(" AND ");
    const total = (this.database.sqlite.prepare(`SELECT COUNT(*) AS value FROM phrases WHERE ${where}`).get(...parameters) as { value: number }).value;
    const rows = this.database.sqlite.prepare(`
      SELECT phrases.*,
        COUNT(audio_takes.id) AS take_count,
        SUM(CASE WHEN audio_takes.review_status = 'primary' THEN 1 ELSE 0 END) AS primary_count,
        SUM(CASE WHEN audio_takes.review_status = 'pending' THEN 1 ELSE 0 END) AS pending_take_count
      FROM phrases LEFT JOIN audio_takes ON audio_takes.phrase_id = phrases.id
      WHERE ${where}
      GROUP BY phrases.id ORDER BY phrases.created_at, COALESCE(phrases.import_id, ''), phrases.source_row, phrases.id
      LIMIT ? OFFSET ?
    `).all(...parameters, query.pageSize, (query.page - 1) * query.pageSize) as Array<Record<string, unknown>>;
    const items = rows.map(mapPhrase);
    return { items, phrases: items, total, page: query.page, pageSize: query.pageSize, pageCount: Math.ceil(total / query.pageSize) };
  }

  patchPhrase(id: string, patch: {
    displayText?: string | undefined;
    synthesisText?: string | null | undefined;
    groupCode?: string | undefined;
    category?: string | undefined;
    tone?: string | undefined;
    englishMeaning?: string | undefined;
    notes?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): Record<string, unknown> {
    const current = this.database.sqlite.prepare("SELECT * FROM phrases WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!current) throw notFound("Phrase");
    const next = {
      displayText: patch.displayText ?? String(current.display_text),
      synthesisText: patch.synthesisText !== undefined ? patch.synthesisText : current.synthesis_text as string | null,
      groupCode: patch.groupCode ?? String(current.group_code),
      category: patch.category ?? String(current.category),
      tone: patch.tone ?? String(current.tone),
      englishMeaning: patch.englishMeaning ?? String(current.english_meaning),
      notes: patch.notes ?? String(current.notes),
      metadata: patch.metadata ?? parseJsonObject(current.metadata_json),
    };
    const previousEffectiveSynthesis = String(current.synthesis_text || current.display_text);
    const nextEffectiveSynthesis = next.synthesisText || next.displayText;
    const now = new Date().toISOString();
    this.database.sqlite.transaction(() => {
      this.database.sqlite.prepare(`
        INSERT INTO phrase_revisions (id, phrase_id, display_text, synthesis_text, group_code, category, notes, reason, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'edit', ?)
      `).run(createId("revision"), id, current.display_text, current.synthesis_text, current.group_code, current.category, current.notes, now);
      this.database.sqlite.prepare(`
        UPDATE phrases SET display_text = ?, synthesis_text = ?, normalized_text = ?, comparison_text = ?,
          group_code = ?, category = ?, tone = ?, english_meaning = ?, notes = ?, metadata_json = ?, updated_at = ?
        WHERE id = ?
      `).run(
        next.displayText, next.synthesisText, normalizePhrase(next.displayText), comparisonPhrase(next.displayText),
        next.groupCode, next.category, next.tone, next.englishMeaning, next.notes, JSON.stringify(next.metadata), now, id,
      );
      if (previousEffectiveSynthesis !== nextEffectiveSynthesis) {
        this.database.sqlite.prepare(`
          UPDATE audio_takes SET review_status = 'pending', updated_at = ?
          WHERE phrase_id = ? AND review_status IN ('primary', 'alternate')
        `).run(now, id);
        this.database.sqlite.prepare("UPDATE phrases SET selected_take_id = NULL WHERE id = ?").run(id);
      }
    })();
    return this.getPhrase(id);
  }

  reviewPhrase(id: string, decision: "pending" | "kept" | "discarded", takeId?: string): Record<string, unknown> {
    if (!this.database.sqlite.prepare("SELECT 1 FROM phrases WHERE id = ?").get(id)) throw notFound("Phrase");
    if (takeId && !this.database.sqlite.prepare("SELECT 1 FROM audio_takes WHERE id = ? AND phrase_id = ?").get(takeId, id)) {
      throw new AppError(400, "TAKE_PHRASE_MISMATCH", "The selected take does not belong to this phrase.");
    }
    const now = new Date().toISOString();
    this.database.sqlite.transaction(() => {
      if (takeId) this.selectPrimaryTake(id, takeId, now);
      this.database.sqlite.prepare("UPDATE phrases SET decision = ?, selected_take_id = COALESCE(?, selected_take_id), updated_at = ? WHERE id = ?").run(decision, takeId ?? null, now, id);
    })();
    return this.getPhrase(id);
  }

  bulkReview(ids: string[], decision: "pending" | "kept" | "discarded"): { updated: number } {
    const uniqueIds = [...new Set(ids)];
    const now = new Date().toISOString();
    let updated = 0;
    const statement = this.database.sqlite.prepare("UPDATE phrases SET decision = ?, updated_at = ? WHERE id = ?");
    this.database.sqlite.transaction(() => {
      for (const id of uniqueIds) updated += statement.run(decision, now, id).changes;
    })();
    return { updated };
  }

  getPhrase(id: string): Record<string, unknown> {
    const row = this.database.sqlite.prepare(`
      SELECT phrases.*, COUNT(audio_takes.id) AS take_count,
        SUM(CASE WHEN audio_takes.review_status = 'primary' THEN 1 ELSE 0 END) AS primary_count,
        SUM(CASE WHEN audio_takes.review_status = 'pending' THEN 1 ELSE 0 END) AS pending_take_count
      FROM phrases LEFT JOIN audio_takes ON audio_takes.phrase_id = phrases.id
      WHERE phrases.id = ? GROUP BY phrases.id
    `).get(id) as Record<string, unknown> | undefined;
    if (!row) throw notFound("Phrase");
    return mapPhrase(row);
  }

  reviewQueue(query: PhraseQuery): Record<string, unknown> {
    const page = this.listPhrases(query);
    const items = (page.items as Array<Record<string, unknown>>).map((phrase) => {
      const takes = this.database.sqlite.prepare(`
        SELECT audio_takes.id, audio_takes.take_number, audio_takes.mime_type, audio_takes.byte_size,
          audio_takes.duration_ms, audio_takes.sha256, audio_takes.review_status, audio_takes.notes,
          audio_takes.voice_profile_version_id, voice_profile_versions.version AS voice_profile_version,
          tts_jobs.seed, tts_jobs.settings_json, audio_takes.created_at
        FROM audio_takes
        JOIN voice_profile_versions ON voice_profile_versions.id = audio_takes.voice_profile_version_id
        JOIN tts_jobs ON tts_jobs.id = audio_takes.job_id
        WHERE audio_takes.phrase_id = ? ORDER BY audio_takes.take_number
      `).all(phrase.id) as Array<Record<string, unknown>>;
      return {
        ...phrase,
        takes: takes.map((take) => ({
          id: take.id,
          phraseId: phrase.id,
          takeNumber: take.take_number,
          audioUrl: `/api/audio/${String(take.id)}`,
          mimeType: take.mime_type,
          byteSize: take.byte_size,
          durationMs: take.duration_ms,
          sha256: take.sha256,
          reviewStatus: take.review_status,
          decision: take.review_status,
          isPrimary: take.review_status === "primary",
          notes: take.notes,
          voiceProfileVersionId: take.voice_profile_version_id,
          voiceProfileVersion: take.voice_profile_version,
          seed: take.seed,
          settingsLabel: "Production recipe",
          createdAt: take.created_at,
        })),
      };
    });
    const counts = this.database.sqlite.prepare(`
      SELECT
        SUM(CASE WHEN decision = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN decision = 'kept' THEN 1 ELSE 0 END) AS kept,
        SUM(CASE WHEN decision = 'discarded' THEN 1 ELSE 0 END) AS discarded
      FROM phrases WHERE project_id = ?
    `).get(query.projectId) as { pending: number | null; kept: number | null; discarded: number | null };
    return {
      ...page,
      items,
      phrases: items,
      counts: {
        pending: Number(counts.pending ?? 0),
        kept: Number(counts.kept ?? 0),
        discarded: Number(counts.discarded ?? 0),
      },
    };
  }

  reviewTake(takeId: string, status: "pending" | "primary" | "alternate" | "rejected", notes?: string): Record<string, unknown> {
    const take = this.database.sqlite.prepare("SELECT phrase_id FROM audio_takes WHERE id = ?").get(takeId) as { phrase_id: string } | undefined;
    if (!take) throw notFound("Audio take");
    const now = new Date().toISOString();
    this.database.sqlite.transaction(() => {
      if (status === "primary") this.selectPrimaryTake(take.phrase_id, takeId, now);
      else {
        this.database.sqlite.prepare("UPDATE audio_takes SET review_status = ?, notes = COALESCE(?, notes), updated_at = ? WHERE id = ?").run(status, notes ?? null, now, takeId);
        this.database.sqlite.prepare("UPDATE phrases SET selected_take_id = NULL, updated_at = ? WHERE id = ? AND selected_take_id = ?").run(now, take.phrase_id, takeId);
      }
    })();
    return this.getPhrase(take.phrase_id);
  }

  private selectPrimaryTake(phraseId: string, takeId: string, now: string): void {
    this.database.sqlite.prepare("UPDATE audio_takes SET review_status = 'pending', updated_at = ? WHERE phrase_id = ? AND review_status = 'primary' AND id != ?").run(now, phraseId, takeId);
    this.database.sqlite.prepare("UPDATE audio_takes SET review_status = 'primary', updated_at = ? WHERE id = ? AND phrase_id = ?").run(now, takeId, phraseId);
    this.database.sqlite.prepare("UPDATE phrases SET selected_take_id = ?, updated_at = ? WHERE id = ?").run(takeId, now, phraseId);
  }
}
