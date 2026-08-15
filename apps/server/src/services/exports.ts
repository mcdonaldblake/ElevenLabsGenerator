import { createReadStream } from "node:fs";
import { constants, createWriteStream } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, posix, relative, resolve, sep } from "node:path";
import { createId, safePathSegment, sha256 } from "@voice-foundry/domain";
import {
  buildAudioMap,
  buildPhrasesCsv,
  outputFileName,
  type ExportAsset,
  type ExportManifest,
} from "@voice-foundry/export-format";
import { ZipFile } from "yazl";
import type { ServerConfig } from "../config.js";
import type { DatabaseContext } from "../db/client.js";
import { AppError, notFound } from "../errors.js";

type ExportPhraseRow = {
  id: string;
  stable_id: string;
  display_text: string;
  synthesis_text: string | null;
  group_code: string;
  category: string;
  tone: string;
  english_meaning: string;
  metadata_json: string;
  primary_count: number;
  take_id: string | null;
  file_path: string | null;
  mime_type: string | null;
  extension: string | null;
  byte_size: number | null;
  duration_ms: number | null;
  audio_sha256: string | null;
  voice_profile_version_id: string | null;
  audio_provider: string | null;
  generated_text: string | null;
};

type ProfileRow = {
  id: string;
  project_id: string;
  label: string;
  provider: string;
  version: number;
  voice_id: string;
  voice_name: string;
  model_id: string;
  language_code: string | null;
  output_format: string;
  stability: number;
  similarity_boost: number;
  style: number;
  speed: number;
  use_speaker_boost: number;
  notes: string;
  locked_at: string;
};

type PreparedAsset = { asset: ExportAsset; sourcePath: string; extension: string };

type ExportPreparation = {
  projectId: string;
  profile: ProfileRow | null;
  assets: PreparedAsset[];
  errors: Array<{ code: string; phraseId?: string; message: string }>;
  warnings: Array<{ code: string; phraseId?: string; message: string }>;
  fingerprint: string | null;
  totalBytes: number;
};

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function profileSnapshot(profile: ProfileRow): Record<string, unknown> {
  return {
    id: profile.id,
    projectId: profile.project_id,
    label: profile.label,
    provider: profile.provider,
    version: profile.version,
    voiceId: profile.voice_id,
    voiceName: profile.voice_name,
    modelId: profile.model_id,
    languageCode: profile.language_code,
    outputFormat: profile.output_format,
    settings: {
      stability: profile.stability,
      similarityBoost: profile.similarity_boost,
      style: profile.style,
      speed: profile.speed,
      useSpeakerBoost: Boolean(profile.use_speaker_boost),
    },
    notes: profile.notes,
    lockedAt: profile.locked_at,
  };
}

function containedPath(root: string, storedPath: string): string | null {
  const absoluteRoot = resolve(root);
  const absolutePath = resolve(absoluteRoot, storedPath);
  return absolutePath === absoluteRoot || absolutePath.startsWith(`${absoluteRoot}${sep}`) ? absolutePath : null;
}

async function filesBelow(root: string): Promise<Array<{ absolute: string; relative: string }>> {
  const result: Array<{ absolute: string; relative: string }> = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) result.push({ absolute, relative: relative(root, absolute).split(sep).join(posix.sep) });
    }
  };
  await visit(root);
  return result.sort((left, right) => left.relative.localeCompare(right.relative));
}

async function createZip(sourceRoot: string, destination: string): Promise<void> {
  const zip = new ZipFile();
  const output = createWriteStream(destination, { flags: "wx" });
  const complete = new Promise<void>((resolvePromise, rejectPromise) => {
    output.once("close", resolvePromise);
    output.once("error", rejectPromise);
    zip.outputStream.once("error", rejectPromise);
  });
  zip.outputStream.pipe(output);
  for (const file of await filesBelow(sourceRoot)) {
    zip.addFile(file.absolute, file.relative, { mtime: new Date("1980-01-01T00:00:00.000Z"), mode: 0o100644 });
  }
  zip.end();
  await complete;
}

export class ExportService {
  constructor(private readonly database: DatabaseContext, private readonly config: ServerConfig) {}

  private async prepare(projectId: string): Promise<ExportPreparation> {
    if (!this.database.sqlite.prepare("SELECT 1 FROM projects WHERE id = ?").get(projectId)) throw notFound("Project");
    const profile = this.database.sqlite.prepare(`
      SELECT * FROM voice_profile_versions
      WHERE project_id = ? AND locked_at IS NOT NULL AND is_production = 1
      ORDER BY version DESC LIMIT 1
    `).get(projectId) as ProfileRow | undefined;
    const rows = this.database.sqlite.prepare(`
      SELECT
        phrases.id, phrases.stable_id, phrases.display_text, phrases.synthesis_text,
        phrases.group_code, phrases.category, phrases.tone, phrases.english_meaning,
        phrases.metadata_json,
        SUM(CASE WHEN audio_takes.review_status = 'primary' THEN 1 ELSE 0 END) AS primary_count,
        MAX(CASE WHEN audio_takes.review_status = 'primary' THEN audio_takes.id END) AS take_id,
        MAX(CASE WHEN audio_takes.review_status = 'primary' THEN audio_takes.file_path END) AS file_path,
        MAX(CASE WHEN audio_takes.review_status = 'primary' THEN audio_takes.mime_type END) AS mime_type,
        MAX(CASE WHEN audio_takes.review_status = 'primary' THEN audio_takes.extension END) AS extension,
        MAX(CASE WHEN audio_takes.review_status = 'primary' THEN audio_takes.byte_size END) AS byte_size,
        MAX(CASE WHEN audio_takes.review_status = 'primary' THEN audio_takes.duration_ms END) AS duration_ms,
        MAX(CASE WHEN audio_takes.review_status = 'primary' THEN audio_takes.sha256 END) AS audio_sha256,
        MAX(CASE WHEN audio_takes.review_status = 'primary' THEN audio_takes.voice_profile_version_id END) AS voice_profile_version_id
        ,MAX(CASE WHEN audio_takes.review_status = 'primary' THEN audio_takes.provider END) AS audio_provider
        ,MAX(CASE WHEN audio_takes.review_status = 'primary' THEN tts_jobs.synthesis_text END) AS generated_text
      FROM phrases
      LEFT JOIN audio_takes ON audio_takes.phrase_id = phrases.id
      LEFT JOIN tts_jobs ON tts_jobs.id = audio_takes.job_id
      WHERE phrases.project_id = ? AND phrases.decision = 'kept'
      GROUP BY phrases.id ORDER BY phrases.stable_id
    `).all(projectId) as ExportPhraseRow[];

    const errors: ExportPreparation["errors"] = [];
    const warnings: ExportPreparation["warnings"] = [];
    const assets: PreparedAsset[] = [];
    if (!profile) errors.push({ code: "NO_LOCKED_PRODUCTION_PROFILE", message: "A locked production voice profile is required." });
    if (profile && profile.provider === "mock") {
      warnings.push({ code: "MOCK_EXPORT", message: "This is a mock-provider test export and does not contain production voice audio." });
    }
    if (rows.length === 0) errors.push({ code: "NO_KEPT_PHRASES", message: "No kept phrases are available for export." });
    const assetIds = new Set<string>();
    const destinations = new Set<string>();

    for (const row of rows) {
      if (row.primary_count !== 1 || !row.take_id || !row.file_path || !row.mime_type || !row.extension || !row.audio_sha256 || row.byte_size == null) {
        errors.push({ code: "PRIMARY_TAKE_REQUIRED", phraseId: row.id, message: "Exactly one primary take is required." });
        continue;
      }
      if (!row.mime_type.startsWith("audio/")) {
        errors.push({ code: "INVALID_AUDIO_MIME", phraseId: row.id, message: `Unsupported MIME type ${row.mime_type}.` });
        continue;
      }
      if (profile && row.voice_profile_version_id !== profile.id) {
        errors.push({ code: "VOICE_PROFILE_MISMATCH", phraseId: row.id, message: "The primary take was not generated with the production profile." });
        continue;
      }
      if (profile && row.audio_provider !== profile.provider) {
        errors.push({ code: "AUDIO_PROVIDER_MISMATCH", phraseId: row.id, message: `The primary take came from ${row.audio_provider ?? "an unknown provider"}, not ${profile.provider}.` });
        continue;
      }
      if (row.generated_text !== (row.synthesis_text || row.display_text)) {
        errors.push({ code: "STALE_PRIMARY_TAKE", phraseId: row.id, message: "The primary take was generated from older phrase text and must be regenerated." });
        continue;
      }
      const group = safePathSegment(row.group_code || "ungrouped");
      const fileName = outputFileName(row.stable_id, row.extension);
      const destination = posix.join("audio", "mara", group, fileName);
      if (assetIds.has(row.stable_id)) {
        errors.push({ code: "DUPLICATE_ASSET_ID", phraseId: row.id, message: `Duplicate asset ID ${row.stable_id}.` });
        continue;
      }
      if (destinations.has(destination)) {
        errors.push({ code: "PATH_COLLISION", phraseId: row.id, message: `Multiple assets target ${destination}.` });
        continue;
      }
      assetIds.add(row.stable_id);
      destinations.add(destination);
      const sourcePath = containedPath(this.config.audioRoot, row.file_path);
      if (!sourcePath) {
        errors.push({ code: "UNSAFE_AUDIO_PATH", phraseId: row.id, message: "The stored source audio path escapes the configured audio directory." });
        continue;
      }
      try {
        const information = await stat(sourcePath);
        if (!information.isFile()) throw new Error("Not a file");
        const bytes = await readFile(sourcePath);
        const actualHash = sha256(bytes);
        if (actualHash !== row.audio_sha256) {
          errors.push({ code: "AUDIO_HASH_MISMATCH", phraseId: row.id, message: "The source audio checksum does not match the database." });
          continue;
        }
        if (bytes.byteLength !== row.byte_size) warnings.push({ code: "BYTE_SIZE_UPDATED", phraseId: row.id, message: "Stored byte size differs from the source file." });
      } catch {
        errors.push({ code: "AUDIO_FILE_MISSING", phraseId: row.id, message: "The source audio file is missing or unreadable." });
        continue;
      }
      const metadata = parseMetadata(row.metadata_json);
      assets.push({
        sourcePath,
        extension: row.extension,
        asset: {
          id: row.stable_id,
          phraseId: row.id,
          text: row.display_text,
          synthesisText: row.synthesis_text || row.display_text,
          group: row.group_code || "ungrouped",
          category: row.category,
          src: destination,
          mimeType: row.mime_type,
          byteSize: row.byte_size,
          durationMs: row.duration_ms,
          sha256: row.audio_sha256,
          voiceProfileVersion: profile?.version ?? 0,
          takeId: row.take_id,
          metadata: { ...metadata, tone: row.tone, englishMeaning: row.english_meaning },
        },
      });
    }
    const fingerprint = profile && errors.length === 0
      ? sha256(JSON.stringify({
          schemaVersion: 1,
          projectId,
          profileId: profile.id,
          assets: assets.map(({ asset }) => asset),
        }))
      : null;
    return {
      projectId,
      profile: profile ?? null,
      assets,
      errors,
      warnings,
      fingerprint,
      totalBytes: assets.reduce((sum, item) => sum + item.asset.byteSize, 0),
    };
  }

  async preview(projectId: string): Promise<Record<string, unknown>> {
    const prepared = await this.prepare(projectId);
    return {
      projectId,
      valid: prepared.errors.length === 0,
      canExport: prepared.errors.length === 0,
      assetCount: prepared.assets.length,
      eligibleAssets: prepared.assets.length,
      excludedPhrases: prepared.errors.filter((error) => error.phraseId).length,
      totalBytes: prepared.totalBytes,
      totalDurationMs: prepared.assets.reduce((sum, item) => sum + (item.asset.durationMs ?? 0), 0),
      voiceProfileVersionId: prepared.profile?.id ?? null,
      fingerprint: prepared.fingerprint,
      errors: prepared.errors,
      errorMessages: prepared.errors.map((error) => error.message),
      warnings: prepared.warnings,
      assets: prepared.assets.map(({ asset }) => asset),
      sampleFiles: prepared.assets.slice(0, 8).map(({ asset }) => asset.src),
    };
  }

  async create(projectId: string, label: string): Promise<Record<string, unknown>> {
    const prepared = await this.prepare(projectId);
    if (!prepared.profile || !prepared.fingerprint || prepared.errors.length > 0) {
      throw new AppError(409, "EXPORT_VALIDATION_FAILED", "Export validation failed.", { details: { errors: prepared.errors } });
    }
    const exportFingerprint = sha256(JSON.stringify({ sourceFingerprint: prepared.fingerprint, label }));
    const existing = this.database.sqlite.prepare("SELECT id FROM exports WHERE project_id = ? AND fingerprint = ?").get(projectId, exportFingerprint) as { id: string } | undefined;
    if (existing) return this.get(existing.id);

    const id = createId("export");
    const createdAt = new Date().toISOString();
    const finalFolder = join(this.config.exportRoot, safePathSegment(id));
    const temporaryFolder = `${finalFolder}.partial`;
    const finalZip = `${finalFolder}.zip`;
    const temporaryZip = `${finalZip}.partial`;
    await mkdir(this.config.exportRoot, { recursive: true });
    await mkdir(temporaryFolder, { recursive: false });

    try {
      for (const item of prepared.assets) {
        const destination = join(temporaryFolder, ...item.asset.src.split("/"));
        await mkdir(join(destination, ".."), { recursive: true });
        await copyFile(item.sourcePath, destination, constants.COPYFILE_EXCL);
      }
      const manifest: ExportManifest = {
        schemaVersion: 1,
        generatedAt: createdAt,
        projectId,
        voiceProfileVersionId: prepared.profile.id,
        assets: prepared.assets.map(({ asset }) => asset),
      };
      const report = {
        schemaVersion: 1,
        exportId: id,
        label,
        generatedAt: createdAt,
        fingerprint: exportFingerprint,
        sourceFingerprint: prepared.fingerprint,
        validation: { valid: true, errors: prepared.errors, warnings: prepared.warnings },
        assetCount: prepared.assets.length,
        totalBytes: prepared.totalBytes,
        originalsPreserved: true,
        postProcessingApplied: false,
      };
      const checksums = prepared.assets.map(({ asset }) => `${asset.sha256}  ${asset.src}`).join("\n") + "\n";
      const readme = [
        "# Frase Uno audio export",
        "",
        `Export ID: ${id}`,
        `Generated: ${createdAt}`,
        "",
        "Copy the audio directory and import audio-map.ts into the target program.",
        "The source recordings were copied without post-processing.",
        "Verify files with checksums.sha256 after moving the export.",
        "",
      ].join("\n");
      const writeOptions = { flag: "wx" as const };
      await writeFile(join(temporaryFolder, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, writeOptions);
      await writeFile(join(temporaryFolder, "audio-map.ts"), buildAudioMap(manifest.assets), writeOptions);
      await writeFile(join(temporaryFolder, "phrases.csv"), buildPhrasesCsv(manifest.assets), writeOptions);
      await writeFile(join(temporaryFolder, "voice-profile.json"), `${JSON.stringify(profileSnapshot(prepared.profile), null, 2)}\n`, writeOptions);
      await writeFile(join(temporaryFolder, "export-report.json"), `${JSON.stringify(report, null, 2)}\n`, writeOptions);
      await writeFile(join(temporaryFolder, "checksums.sha256"), checksums, writeOptions);
      await writeFile(join(temporaryFolder, "README.md"), readme, writeOptions);
      await createZip(temporaryFolder, temporaryZip);
      await rename(temporaryFolder, finalFolder);
      await rename(temporaryZip, finalZip);
      this.database.sqlite.prepare(`
        INSERT INTO exports (
          id, project_id, voice_profile_version_id, label, fingerprint, status,
          folder_path, zip_path, asset_count, total_bytes, report_json, created_at
        ) VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?)
      `).run(
        id, projectId, prepared.profile.id, label, exportFingerprint,
        finalFolder, finalZip, prepared.assets.length, prepared.totalBytes, JSON.stringify(report), createdAt,
      );
      return this.get(id);
    } catch (error) {
      await rm(temporaryFolder, { recursive: true, force: true });
      await rm(temporaryZip, { force: true });
      await rm(finalFolder, { recursive: true, force: true });
      await rm(finalZip, { force: true });
      throw error;
    }
  }

  list(projectId?: string): Record<string, unknown>[] {
    const rows = projectId
      ? this.database.sqlite.prepare("SELECT * FROM exports WHERE project_id = ? ORDER BY created_at DESC").all(projectId)
      : this.database.sqlite.prepare("SELECT * FROM exports ORDER BY created_at DESC").all();
    return (rows as Array<Record<string, unknown>>).map((row) => this.map(row));
  }

  get(id: string): Record<string, unknown> {
    const row = this.database.sqlite.prepare("SELECT * FROM exports WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) throw notFound("Export");
    return this.map(row);
  }

  download(id: string): { stream: ReturnType<typeof createReadStream>; fileName: string; byteSize: number } {
    const row = this.database.sqlite.prepare("SELECT zip_path FROM exports WHERE id = ? AND status = 'completed'").get(id) as { zip_path: string } | undefined;
    if (!row) throw notFound("Export");
    try {
      const zipPath = containedPath(this.config.exportRoot, row.zip_path);
      if (!zipPath) throw new Error("Unsafe export path");
      const size = statSyncSafe(zipPath);
      return { stream: createReadStream(zipPath), fileName: basename(zipPath), byteSize: size };
    } catch {
      throw new AppError(410, "EXPORT_FILE_MISSING", "The export ZIP is no longer available on disk.");
    }
  }

  private map(row: Record<string, unknown>): Record<string, unknown> {
    return {
      id: row.id,
      projectId: row.project_id,
      voiceProfileVersionId: row.voice_profile_version_id,
      label: row.label,
      fingerprint: row.fingerprint,
      status: row.status,
      folderPath: row.folder_path,
      downloadUrl: `/api/exports/${String(row.id)}/download`,
      assetCount: row.asset_count,
      totalBytes: row.total_bytes,
      report: typeof row.report_json === "string" ? JSON.parse(row.report_json) : {},
      createdAt: row.created_at,
    };
  }
}

function statSyncSafe(path: string): number {
  const information = requireStat(path);
  if (!information.isFile()) throw new Error("Not a file");
  return information.size;
}

// Kept separate so download remains synchronous until Fastify owns the stream.
function requireStat(path: string): import("node:fs").Stats {
  // eslint-free ESM-friendly indirection; createReadStream will surface later I/O errors.
  return statSync(path);
}

import { statSync } from "node:fs";
