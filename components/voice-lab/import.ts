import type { ImportCandidate, ImportPreview } from "./types";

export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 100_000;

const TEXT_ALIASES = new Set(["text", "phrase", "line"]);
const ID_ALIASES = new Set(["id", "phrase_id", "phraseid", "external_id", "externalid"]);
const FILENAME_ALIASES = new Set(["filename", "file_name", "file", "name"]);
const PUNCTUATION = /[\p{P}\p{S}]+/gu;
const WHITESPACE = /\s+/g;
const BOM = /^\uFEFF/;

type ParsedRecord = Record<string, unknown>;

function normalizedHeader(value: string): string {
  return value.trim().toLocaleLowerCase("en-US").replaceAll("-", "_").replaceAll(" ", "_");
}

export function duplicateKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(PUNCTUATION, " ")
    .replace(WHITESPACE, " ")
    .trim();
}

function asText(value: unknown): string {
  if (value == null) return "";
  return typeof value === "string" ? value.trim() : String(value).trim();
}

function findField(record: ParsedRecord, aliases: Set<string>): string {
  for (const [key, value] of Object.entries(record)) {
    if (aliases.has(normalizedHeader(key))) return asText(value);
  }
  return "";
}

export function parseDelimited(content: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const next = content[index + 1];
    if (character === "\"") {
      if (quoted && next === "\"") {
        field += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character ?? "";
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

function delimitedRecords(content: string, delimiter: string): { records: ParsedRecord[]; rowOffset: number } {
  const rows = parseDelimited(content, delimiter);
  const header = rows[0] ?? [];
  const hasHeader = header.some((cell) => {
    const normalized = normalizedHeader(cell);
    return TEXT_ALIASES.has(normalized) || ID_ALIASES.has(normalized) || FILENAME_ALIASES.has(normalized);
  });
  if (!hasHeader) return { records: rows.map((row) => ({ text: row[0] ?? "" })), rowOffset: 1 };

  const headers = header.map(normalizedHeader);
  return {
    records: rows.slice(1).map((row) => Object.fromEntries(headers.map((key, index) => [key, row[index] ?? ""]))),
    rowOffset: 2,
  };
}

function jsonRecords(content: string): ParsedRecord[] {
  const parsed: unknown = JSON.parse(content);
  const root = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as ParsedRecord : {};
  const candidates = Array.isArray(root.phrases) ? root.phrases : parsed;
  if (!Array.isArray(candidates)) throw new Error("JSON must be an array or an object with a phrases array.");
  return candidates.map((candidate) => {
    if (typeof candidate === "object" && candidate !== null && !Array.isArray(candidate)) return candidate as ParsedRecord;
    return { text: asText(candidate) };
  });
}

function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  return index < 0 ? "txt" : fileName.slice(index + 1).toLocaleLowerCase("en-US");
}

function createPreview(records: ParsedRecord[], fileName: string, fileType: string, rowOffset: number, existingTexts: Iterable<string>): ImportPreview {
  if (records.length > MAX_IMPORT_ROWS) throw new Error(`Imports are limited to ${MAX_IMPORT_ROWS.toLocaleString()} rows.`);
  const seen = new Set(Array.from(existingTexts, duplicateKey).filter(Boolean));
  const rows: ImportCandidate[] = records.map((record, index) => {
    const text = findField(record, TEXT_ALIASES);
    const candidate = {
      sourceRow: index + rowOffset,
      id: findField(record, ID_ALIASES),
      filename: findField(record, FILENAME_ALIASES),
      text,
    };
    const key = duplicateKey(text);
    if (!text) return { ...candidate, status: "invalid" as const, issue: "Text is empty" };
    if (text.length > 5_000) return { ...candidate, status: "invalid" as const, issue: "Text exceeds 5,000 characters" };
    if (seen.has(key)) return { ...candidate, status: "duplicate" as const, issue: "Repeated text" };
    seen.add(key);
    return { ...candidate, status: "valid" as const, issue: null };
  });
  return {
    fileName,
    fileType: fileType.toLocaleUpperCase("en-US"),
    totalRows: rows.length,
    validRows: rows.filter((row) => row.status === "valid").length,
    duplicateRows: rows.filter((row) => row.status === "duplicate").length,
    invalidRows: rows.filter((row) => row.status === "invalid").length,
    rows,
  };
}

export function parsePhraseContent(content: string, fileName: string, existingTexts: Iterable<string> = []): ImportPreview {
  const cleanContent = content.replace(BOM, "");
  const extension = extensionOf(fileName);
  if (!new Set(["txt", "csv", "tsv", "json"]).has(extension)) {
    throw new Error("Choose a TXT, CSV, TSV, or JSON file.");
  }
  if (extension === "json") return createPreview(jsonRecords(cleanContent), fileName, extension, 1, existingTexts);
  if (extension === "txt") {
    const records = cleanContent.split(/\r?\n/).filter((text) => text.trim()).map((text) => ({ text }));
    return createPreview(records, fileName, extension, 1, existingTexts);
  }
  const firstLine = cleanContent.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = extension === "tsv" || firstLine.split("\t").length > firstLine.split(",").length ? "\t" : ",";
  const { records, rowOffset } = delimitedRecords(cleanContent, delimiter);
  return createPreview(records, fileName, extension, rowOffset, existingTexts);
}

export async function parsePhraseFile(file: File, existingTexts: Iterable<string> = []): Promise<ImportPreview> {
  if (file.size > MAX_IMPORT_BYTES) throw new Error("Imports are limited to 25 MB.");
  return parsePhraseContent(await file.text(), file.name, existingTexts);
}

export function parseMultiline(value: string, existingTexts: Iterable<string> = []): ImportPreview {
  return createPreview(
    value.split(/\r?\n/).filter((text) => text.trim()).map((text) => ({ text })),
    "Pasted phrases",
    "text",
    1,
    existingTexts,
  );
}
