import type { ImportPreview, ImportPreviewRow } from "../types";

const HEADER_ALIASES: Record<string, string[]> = {
  externalId: ["id", "phrase_id", "phraseid", "external_id", "externalid", "code"],
  displayText: ["phrase", "text", "display_text", "displaytext", "spanish", "es", "line"],
  synthesisText: ["synthesis_text", "synthesistext", "tts_text", "ttstext", "spoken_text"],
  groupCode: ["group", "group_code", "groupcode", "transition", "transition_code", "set"],
  category: ["category", "type"],
  tone: ["tone"],
  englishMeaning: ["english_meaning", "englishmeaning", "translation", "english"],
  notes: ["notes", "note", "comment", "comments"],
};

const WHITESPACE_PATTERN = /\s+/g;
const PUNCTUATION_PATTERN = /[\p{P}\p{S}]+/gu;
const UTF8_BOM = /^\uFEFF/;

type ParsedObject = Record<string, unknown>;

function isRecord(value: unknown): value is ParsedObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asText(value: unknown): string {
  if (value == null) return "";
  return typeof value === "string" ? value.trim() : String(value).trim();
}

function normalizedHeader(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("en-US")
    .replaceAll("-", "_")
    .replaceAll(" ", "_");
}

function normalizeForDuplicate(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("es-MX")
    .replace(PUNCTUATION_PATTERN, " ")
    .replace(WHITESPACE_PATTERN, " ")
    .trim();
}

function findField(record: ParsedObject, field: keyof typeof HEADER_ALIASES): string {
  const candidates = new Set(HEADER_ALIASES[field]);
  for (const [key, value] of Object.entries(record)) {
    if (candidates.has(normalizedHeader(key))) return asText(value);
  }
  return "";
}

function recordToRow(record: ParsedObject, sourceRow: number): Omit<ImportPreviewRow, "status" | "issue"> {
  return {
    sourceRow,
    externalId: findField(record, "externalId"),
    displayText: findField(record, "displayText"),
    synthesisText: findField(record, "synthesisText") || null,
    groupCode: findField(record, "groupCode"),
    category: findField(record, "category"),
    tone: findField(record, "tone"),
    englishMeaning: findField(record, "englishMeaning"),
    notes: findField(record, "notes"),
  };
}

export function parseDelimited(content: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const next = content[index + 1];
    if (character === '"') {
      if (quoted && next === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      row.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character ?? "";
    }
  }

  row.push(value);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

function delimitedToObjects(content: string, delimiter: string): ParsedObject[] {
  const rows = parseDelimited(content, delimiter);
  const firstRow = rows[0] ?? [];
  const likelyHasHeader = firstRow.some((cell) => {
    const normalized = normalizedHeader(cell);
    return Object.values(HEADER_ALIASES).some((aliases) => aliases.includes(normalized));
  });

  if (!likelyHasHeader) {
    return rows.map((row) => ({ text: row[0] ?? "" }));
  }

  const headers = firstRow.map(normalizedHeader);
  return rows.slice(1).map((row) => {
    const record: ParsedObject = {};
    headers.forEach((header, index) => {
      record[header] = row[index] ?? "";
    });
    return record;
  });
}

function jsonToObjects(content: string): ParsedObject[] {
  const parsed: unknown = JSON.parse(content);
  const candidate = isRecord(parsed) && Array.isArray(parsed.phrases) ? parsed.phrases : parsed;
  if (!Array.isArray(candidate)) {
    throw new Error("JSON imports must be an array or an object with a phrases array.");
  }
  return candidate.map((value) => (isRecord(value) ? value : { text: asText(value) }));
}

function getExtension(fileName: string): string {
  const lastPeriod = fileName.lastIndexOf(".");
  return lastPeriod >= 0 ? fileName.slice(lastPeriod + 1).toLocaleLowerCase("en-US") : "txt";
}

function detectDelimiter(content: string, extension: string): string {
  if (extension === "tsv") return "\t";
  const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
  const tabs = firstLine.split("\t").length;
  const commas = firstLine.split(",").length;
  return tabs > commas ? "\t" : ",";
}

export function parsePhraseContent(content: string, fileName: string): ImportPreview {
  const cleanContent = content.replace(UTF8_BOM, "");
  const extension = getExtension(fileName);
  let records: ParsedObject[];

  if (extension === "json") {
    records = jsonToObjects(cleanContent);
  } else if (extension === "csv" || extension === "tsv") {
    records = delimitedToObjects(cleanContent, detectDelimiter(cleanContent, extension));
  } else {
    records = cleanContent
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => ({ text: line.trim() }));
  }

  const duplicateKeys = new Set<string>();
  const rows: ImportPreviewRow[] = records.map((record, index) => {
    const candidate = recordToRow(record, index + (extension === "csv" || extension === "tsv" ? 2 : 1));
    const duplicateKey = normalizeForDuplicate(candidate.displayText);
    if (!candidate.displayText) {
      return { ...candidate, status: "invalid", issue: "Phrase text is empty" };
    }
    if (duplicateKeys.has(duplicateKey)) {
      return { ...candidate, status: "duplicate", issue: "Repeated in this file" };
    }
    duplicateKeys.add(duplicateKey);
    return { ...candidate, status: "valid", issue: null };
  });

  const detectedFields = new Set<string>();
  for (const record of records.slice(0, 25)) {
    for (const key of Object.keys(record)) detectedFields.add(normalizedHeader(key));
  }

  return {
    fileName,
    fileType: extension.toLocaleUpperCase("en-US"),
    totalRows: rows.length,
    validRows: rows.filter((row) => row.status === "valid").length,
    duplicateRows: rows.filter((row) => row.status === "duplicate").length,
    invalidRows: rows.filter((row) => row.status === "invalid").length,
    detectedFields: Array.from(detectedFields),
    warnings: ["This browser-only preview is informational. Reconnect the local server before committing the file."],
    rows,
  };
}

export async function parsePhraseFile(file: File): Promise<ImportPreview> {
  return parsePhraseContent(await file.text(), file.name);
}
