import { basename, extname } from "node:path";
import { parse } from "csv-parse/sync";
import { comparisonPhrase, createId, normalizePhrase, sha256, stablePhraseId } from "@voice-foundry/domain";
import type { DatabaseContext } from "../db/client.js";
import { AppError, notFound } from "../errors.js";

export type ImportFormat = "csv" | "tsv" | "txt" | "json";

export type ParsedPhrase = {
  sourceRow: number;
  suppliedId?: string;
  displayText: string;
  synthesisText: string | null;
  groupCode: string;
  category: string;
  tone: string;
  englishMeaning: string;
  notes: string;
  metadata: Record<string, unknown>;
};

export type ImportIssue = {
  row: number;
  code: string;
  message: string;
};

export type ImportPreview = {
  fileName: string;
  format: ImportFormat;
  sourceHash: string;
  totalRows: number;
  validRows: number;
  importableRows: number;
  invalidRows: number;
  duplicateTextRows: number;
  existingTextRows: number;
  stableIdCollisions: number;
  issues: ImportIssue[];
  sample: Array<ParsedPhrase & { stableId: string; warnings: string[] }>;
  truncated: boolean;
};

const aliases = {
  id: ["id", "phrase_id", "phraseid", "key"],
  text: ["text", "phrase", "display_text", "displaytext", "spanish", "es"],
  synthesisText: ["synthesis_text", "synthesistext", "provider_text", "tts_text"],
  groupCode: ["group", "group_code", "groupcode", "transition", "transition_code"],
  category: ["category", "type"],
  tone: ["tone"],
  englishMeaning: ["english_meaning", "englishmeaning", "english", "translation"],
  notes: ["notes", "note"],
  metadata: ["metadata", "metadata_json"],
} as const;

function canonicalHeader(value: string): string {
  return value.trim().toLocaleLowerCase("en-US").replace(/[\s-]+/g, "_");
}

function findValue(record: Record<string, unknown>, names: readonly string[]): unknown {
  const normalized = new Map(Object.entries(record).map(([key, value]) => [canonicalHeader(key), value]));
  for (const name of names) {
    if (normalized.has(name)) return normalized.get(name);
  }
  return undefined;
}

function optionalString(value: unknown): string {
  if (value == null) return "";
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return "";
  return String(value).trim();
}

function parseMetadata(value: unknown, record: Record<string, unknown>): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return { importedMetadata: value };
    }
  }
  const known = new Set<string>(Object.values(aliases).flat());
  return Object.fromEntries(Object.entries(record).filter(([key]) => !known.has(canonicalHeader(key))));
}

function toPhrase(record: Record<string, unknown>, sourceRow: number): ParsedPhrase {
  const displayText = optionalString(findValue(record, aliases.text));
  const synthesisText = optionalString(findValue(record, aliases.synthesisText));
  const suppliedId = optionalString(findValue(record, aliases.id));
  return {
    sourceRow,
    ...(suppliedId ? { suppliedId } : {}),
    displayText,
    synthesisText: synthesisText || null,
    groupCode: optionalString(findValue(record, aliases.groupCode)) || "ungrouped",
    category: optionalString(findValue(record, aliases.category)),
    tone: optionalString(findValue(record, aliases.tone)),
    englishMeaning: optionalString(findValue(record, aliases.englishMeaning)),
    notes: optionalString(findValue(record, aliases.notes)),
    metadata: parseMetadata(findValue(record, aliases.metadata), record),
  };
}

function decode(buffer: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\uFEFF/, "");
  } catch {
    throw new AppError(400, "INVALID_TEXT_ENCODING", "Import files must be UTF-8 encoded.");
  }
}

function detectFormat(fileName: string): ImportFormat {
  const extension = extname(fileName).slice(1).toLocaleLowerCase("en-US");
  if (extension === "csv" || extension === "tsv" || extension === "txt" || extension === "json") return extension;
  throw new AppError(400, "UNSUPPORTED_IMPORT_FORMAT", "Use a .csv, .tsv, .txt, or .json file.");
}

function parseDelimited(text: string, delimiter: "," | "\t"): ParsedPhrase[] {
  let records: string[][];
  try {
    records = parse(text, {
      bom: true,
      delimiter,
      skip_empty_lines: true,
      relax_column_count: false,
      trim: true,
      max_record_size: 50_000,
    }) as string[][];
  } catch (error) {
    throw new AppError(400, "INVALID_DELIMITED_FILE", "The delimited file could not be parsed.", {
      details: { cause: error instanceof Error ? error.message : "Unknown parse error" },
    });
  }
  if (records.length === 0) return [];
  const first = records[0] ?? [];
  const headerNames = first.map(canonicalHeader);
  const hasTextHeader = headerNames.some((name) => aliases.text.includes(name as (typeof aliases.text)[number]));
  if (!hasTextHeader) {
    if (records.some((row) => row.length !== 1)) {
      throw new AppError(400, "MISSING_TEXT_COLUMN", "CSV and TSV files need a text column (text, phrase, display_text, spanish, or es). Headerless files may contain one column only.");
    }
    return records.map((row, index) => toPhrase({ text: row[0] ?? "" }, index + 1));
  }
  return records.slice(1).map((row, index) => {
    const record = Object.fromEntries(first.map((header, column) => [header, row[column] ?? ""]));
    return toPhrase(record, index + 2);
  });
}

function parseJson(text: string): ParsedPhrase[] {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    throw new AppError(400, "INVALID_JSON", "The JSON import file is not valid JSON.");
  }
  const rows = Array.isArray(root)
    ? root
    : root && typeof root === "object" && Array.isArray((root as { phrases?: unknown }).phrases)
      ? (root as { phrases: unknown[] }).phrases
      : null;
  if (!rows) throw new AppError(400, "INVALID_JSON_SHAPE", "JSON must be an array or an object with a phrases array.");
  return rows.map((row, index) => {
    if (typeof row === "string") return toPhrase({ text: row }, index + 1);
    if (!row || typeof row !== "object" || Array.isArray(row)) return toPhrase({}, index + 1);
    return toPhrase(row as Record<string, unknown>, index + 1);
  });
}

export function parseImportFile(buffer: Uint8Array, fileName: string, maxRows: number): {
  fileName: string;
  format: ImportFormat;
  sourceHash: string;
  rows: ParsedPhrase[];
  issues: ImportIssue[];
} {
  const safeName = basename(fileName).slice(0, 255) || "phrases.txt";
  const format = detectFormat(safeName);
  const text = decode(buffer);
  const rows = format === "json"
    ? parseJson(text)
    : format === "txt"
      ? text.split(/\r?\n/).map((line, index) => ({ line, row: index + 1 })).filter(({ line }) => line.trim()).map(({ line, row }) => toPhrase({ text: line }, row))
      : parseDelimited(text, format === "csv" ? "," : "\t");
  if (rows.length > maxRows) {
    throw new AppError(413, "IMPORT_ROW_LIMIT", `The file contains ${rows.length} rows; the limit is ${maxRows}.`);
  }
  const issues: ImportIssue[] = [];
  for (const row of rows) {
    if (!row.displayText) issues.push({ row: row.sourceRow, code: "EMPTY_TEXT", message: "Phrase text is required." });
    if (row.displayText.length > 5_000) issues.push({ row: row.sourceRow, code: "TEXT_TOO_LONG", message: "Phrase text exceeds 5,000 characters." });
    if (row.synthesisText && row.synthesisText.length > 5_000) issues.push({ row: row.sourceRow, code: "SYNTHESIS_TEXT_TOO_LONG", message: "Synthesis text exceeds 5,000 characters." });
    if (row.groupCode.length > 100) issues.push({ row: row.sourceRow, code: "GROUP_TOO_LONG", message: "Group code exceeds 100 characters." });
  }
  return { fileName: safeName, format, sourceHash: sha256(buffer), rows, issues };
}

type ExistingPhrase = { stable_id: string; normalized_text: string };

export class ImportService {
  constructor(private readonly database: DatabaseContext, private readonly maxRows: number) {}

  private existing(projectId: string | null): ExistingPhrase[] {
    if (!projectId) return [];
    return this.database.sqlite.prepare("SELECT stable_id, normalized_text FROM phrases WHERE project_id = ?").all(projectId) as ExistingPhrase[];
  }

  preview(buffer: Uint8Array, fileName: string, projectId: string | null): ImportPreview {
    if (projectId && !this.database.sqlite.prepare("SELECT 1 FROM projects WHERE id = ?").get(projectId)) throw notFound("Project");
    const parsed = parseImportFile(buffer, fileName, this.maxRows);
    const invalidRows = new Set(parsed.issues.map((issue) => issue.row));
    const existing = this.existing(projectId);
    const existingNormalized = new Set(existing.map((row) => row.normalized_text));
    const existingStable = new Set(existing.map((row) => row.stable_id));
    const seenNormalized = new Set<string>();
    const seenStable = new Set<string>();
    let duplicateTextRows = 0;
    let existingTextRows = 0;
    let stableIdCollisions = 0;
    const mapped = parsed.rows.map((row) => {
      const normalized = normalizePhrase(row.displayText);
      const stableId = stablePhraseId(row.suppliedId, parsed.sourceHash, row.sourceRow);
      const warnings: string[] = [];
      if (normalized && seenNormalized.has(normalized)) {
        warnings.push("duplicate_text_in_file");
        duplicateTextRows += 1;
      }
      if (normalized && existingNormalized.has(normalized)) {
        warnings.push("duplicate_text_in_project");
        existingTextRows += 1;
      }
      if (seenStable.has(stableId) || existingStable.has(stableId)) {
        warnings.push("stable_id_collision");
        stableIdCollisions += 1;
      }
      seenNormalized.add(normalized);
      seenStable.add(stableId);
      return { ...row, stableId, warnings };
    });
    const sample = mapped.slice(0, 100).map((row) => ({
      ...row,
      status: invalidRows.has(row.sourceRow)
        ? "invalid"
        : row.warnings.some((warning) => warning.includes("duplicate"))
          ? "duplicate"
          : "valid",
      issue: parsed.issues.find((issue) => issue.row === row.sourceRow)?.message ?? row.warnings[0] ?? null,
      externalId: row.stableId,
    }));
    return {
      fileName: parsed.fileName,
      format: parsed.format,
      sourceHash: parsed.sourceHash,
      totalRows: parsed.rows.length,
      validRows: parsed.rows.length - invalidRows.size - stableIdCollisions,
      importableRows: parsed.rows.length - invalidRows.size - stableIdCollisions,
      invalidRows: invalidRows.size,
      duplicateTextRows,
      existingTextRows,
      stableIdCollisions,
      issues: parsed.issues.slice(0, 200),
      sample,
      rows: sample,
      fileType: parsed.format.toUpperCase(),
      duplicateRows: duplicateTextRows + existingTextRows,
      detectedFields: ["text", "id", "synthesis_text", "group", "category", "tone", "english_meaning", "notes", "metadata"],
      warnings: [
        ...(duplicateTextRows > 0 ? [`${duplicateTextRows} duplicate phrase rows were found in the file.`] : []),
        ...(existingTextRows > 0 ? [`${existingTextRows} rows match existing project wording.`] : []),
        ...(stableIdCollisions > 0 ? [`${stableIdCollisions} stable IDs will be skipped during commit.`] : []),
      ],
      truncated: mapped.length > 100 || parsed.issues.length > 200,
    } as ImportPreview;
  }

  private resolveProject(projectId: string | null): string {
    if (projectId) {
      if (!this.database.sqlite.prepare("SELECT 1 FROM projects WHERE id = ?").get(projectId)) throw notFound("Project");
      return projectId;
    }
    const existing = this.database.sqlite.prepare("SELECT id FROM projects ORDER BY updated_at DESC LIMIT 1").get() as { id: string } | undefined;
    if (existing) return existing.id;
    const id = createId("project");
    const now = new Date().toISOString();
    this.database.sqlite.prepare("INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?, ?, '', ?, ?)").run(id, "Imported phrases", now, now);
    return id;
  }

  commit(buffer: Uint8Array, fileName: string, requestedProjectId: string | null): Record<string, unknown> {
    const projectId = this.resolveProject(requestedProjectId);
    const parsed = parseImportFile(buffer, fileName, this.maxRows);
    const invalidRows = new Set(parsed.issues.map((issue) => issue.row));
    const importId = createId("import");
    const now = new Date().toISOString();
    const insert = this.database.sqlite.prepare(`
      INSERT INTO phrases (
        id, project_id, import_id, stable_id, supplied_id, source_hash, source_row,
        display_text, original_text, synthesis_text, normalized_text, comparison_text,
        group_code, category, tone, english_meaning, notes, metadata_json,
        decision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `);
    const stableExists = this.database.sqlite.prepare("SELECT 1 FROM phrases WHERE project_id = ? AND stable_id = ?");
    const seenStable = new Set<string>();
    let insertedRows = 0;
    let skippedRows = 0;
    const skipped: ImportIssue[] = [];

    this.database.sqlite.transaction(() => {
      this.database.sqlite.prepare(`
        INSERT INTO imports (id, project_id, file_name, format, source_hash, status, total_rows, inserted_rows, skipped_rows, error_rows, summary_json, created_at)
        VALUES (?, ?, ?, ?, ?, 'committing', ?, 0, 0, ?, '{}', ?)
      `).run(importId, projectId, parsed.fileName, parsed.format, parsed.sourceHash, parsed.rows.length, invalidRows.size, now);

      for (const row of parsed.rows) {
        if (invalidRows.has(row.sourceRow)) {
          skippedRows += 1;
          continue;
        }
        const stableId = stablePhraseId(row.suppliedId, parsed.sourceHash, row.sourceRow);
        if (seenStable.has(stableId) || stableExists.get(projectId, stableId)) {
          skippedRows += 1;
          skipped.push({ row: row.sourceRow, code: "STABLE_ID_COLLISION", message: `Stable ID ${stableId} already exists.` });
          continue;
        }
        seenStable.add(stableId);
        insert.run(
          createId("phrase"), projectId, importId, stableId, row.suppliedId ?? null, parsed.sourceHash, row.sourceRow,
          row.displayText, row.displayText, row.synthesisText, normalizePhrase(row.displayText), comparisonPhrase(row.displayText),
          row.groupCode, row.category, row.tone, row.englishMeaning, row.notes, JSON.stringify(row.metadata), now, now,
        );
        insertedRows += 1;
      }

      const summary = {
        insertedRows,
        skippedRows,
        invalidRows: invalidRows.size,
        issues: [...parsed.issues, ...skipped].slice(0, 500),
      };
      this.database.sqlite.prepare(`
        UPDATE imports SET status = 'completed', inserted_rows = ?, skipped_rows = ?, summary_json = ? WHERE id = ?
      `).run(insertedRows, skippedRows, JSON.stringify(summary), importId);
      this.database.sqlite.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now, projectId);
    })();

    return this.get(importId);
  }

  get(id: string): Record<string, unknown> {
    const row = this.database.sqlite.prepare("SELECT * FROM imports WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) throw notFound("Import");
    return {
      id: row.id,
      projectId: row.project_id,
      fileName: row.file_name,
      format: row.format,
      sourceHash: row.source_hash,
      status: row.status,
      totalRows: row.total_rows,
      insertedRows: row.inserted_rows,
      skippedRows: row.skipped_rows,
      errorRows: row.error_rows,
      summary: JSON.parse(String(row.summary_json)),
      createdAt: row.created_at,
    };
  }
}
