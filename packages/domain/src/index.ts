import { createHash, randomUUID } from "node:crypto";

const punctuationPattern = /[\p{P}\p{S}]+/gu;
const whitespacePattern = /\s+/g;
const unsafeIdPattern = /[^a-z0-9_-]+/g;

export type ReviewDecision = "pending" | "kept" | "discarded";
export type JobStatus =
  | "draft"
  | "queued"
  | "running"
  | "retry_wait"
  | "succeeded"
  | "failed"
  | "canceled"
  | "superseded";

export type VoiceSettings = {
  stability: number;
  similarityBoost: number;
  style: number;
  speed: number;
  useSpeakerBoost: boolean;
};

export type JobFingerprintInput = {
  synthesisText: string;
  voiceProfileVersionId: string;
  voiceId: string;
  modelId: string;
  outputFormat: string;
  languageCode: string | null;
  settings: VoiceSettings;
  seed: number;
};

export function normalizePhrase(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("es-MX")
    .replace(punctuationPattern, " ")
    .replace(whitespacePattern, " ")
    .trim();
}

export function comparisonPhrase(value: string): string {
  return normalizePhrase(value).normalize("NFD").replace(/\p{M}/gu, "");
}

export function stablePhraseId(
  suppliedId: string | undefined,
  sourceHash: string,
  sourceRow: number,
): string {
  if (suppliedId?.trim()) {
    const normalized = suppliedId
      .normalize("NFKD")
      .toLocaleLowerCase("en-US")
      .replace(/\p{M}/gu, "")
      .replace(unsafeIdPattern, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
    if (normalized) return normalized;
  }
  return `phrase-${sourceHash.slice(0, 10)}-${String(sourceRow).padStart(6, "0")}`;
}

export function safePathSegment(value: string): string {
  const result = stablePhraseId(value, createHash("sha256").update(value).digest("hex"), 1);
  if (!result || result === "." || result === "..") {
    throw new Error("The value cannot be converted into a safe path segment.");
  }
  return result;
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function jobFingerprint(input: JobFingerprintInput): string {
  return sha256(JSON.stringify({
    synthesisText: input.synthesisText.normalize("NFC"),
    voiceProfileVersionId: input.voiceProfileVersionId,
    voiceId: input.voiceId,
    modelId: input.modelId,
    outputFormat: input.outputFormat,
    languageCode: input.languageCode,
    settings: input.settings,
    seed: input.seed,
  }));
}

export function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export function countWords(value: string): number {
  const normalized = value.trim();
  return normalized ? normalized.split(whitespacePattern).length : 0;
}

export function csvEscape(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
