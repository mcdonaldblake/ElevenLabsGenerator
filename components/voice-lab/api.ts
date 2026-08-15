import type { AccountVoice, SharedVoice, SharedVoicePage, VoiceRecipe } from "./types";

export class VoiceLabApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, status: number, code: string, retryable: boolean) {
    super(message);
    this.name = "VoiceLabApiError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeAccountVoice(value: unknown, index: number): AccountVoice {
  const source = record(value);
  const labels = record(source.labels);
  return {
    id: text(source.id ?? source.voiceId ?? source.voice_id, `voice-${index + 1}`),
    name: text(source.name, "Untitled voice"),
    description: text(source.description),
    category: text(source.category, "Account voice"),
    previewUrl: text(source.previewUrl ?? source.preview_url) || null,
    labels: Object.fromEntries(
      Object.entries(labels).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    ),
  };
}

function normalizeSharedVoice(value: unknown, index: number): SharedVoice {
  const source = record(value);
  return {
    publicOwnerId: text(source.publicOwnerId ?? source.public_owner_id, `owner-${index + 1}`),
    voiceId: text(source.voiceId ?? source.voice_id, `voice-${index + 1}`),
    name: text(source.name, "Untitled voice"),
    accent: text(source.accent),
    gender: text(source.gender),
    age: text(source.age),
    descriptive: stringList(source.descriptive),
    useCase: stringList(source.useCase ?? source.use_case),
    category: text(source.category),
    language: text(source.language),
    locale: text(source.locale) || null,
    description: text(source.description),
    previewUrl: text(source.previewUrl ?? source.preview_url) || null,
    verifiedLanguages: stringList(source.verifiedLanguages ?? source.verified_languages),
    featured: bool(source.featured),
    freeUsersAllowed: bool(source.freeUsersAllowed ?? source.free_users_allowed, true),
    liveModerationEnabled: bool(source.liveModerationEnabled ?? source.live_moderation_enabled),
    rate: typeof source.rate === "number" && Number.isFinite(source.rate) ? source.rate : null,
  };
}

function unwrap(value: unknown): Record<string, unknown> {
  const root = record(value);
  const data = record(root.data);
  return Object.keys(data).length > 0 ? data : root;
}

async function errorFromResponse(response: Response): Promise<VoiceLabApiError> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // A provider or platform error can be an empty/non-JSON response.
  }
  const root = record(payload);
  const detail = record(root.error);
  return new VoiceLabApiError(
    text(detail.message ?? root.message, `The request failed (${response.status}).`),
    response.status,
    text(detail.code ?? root.code, "REQUEST_FAILED"),
    bool(detail.retryable ?? root.retryable, response.status >= 500),
  );
}

async function jsonRequest(path: string, init?: RequestInit): Promise<unknown> {
  const headers = new Headers(init?.headers);
  headers.set("accept", "application/json");
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  let response: Response;
  try {
    response = await fetch(path, { ...init, headers, credentials: "same-origin", cache: "no-store" });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new VoiceLabApiError("Voice Lab could not reach the server.", 0, "NETWORK_ERROR", true);
  }
  if (!response.ok) throw await errorFromResponse(response);
  return response.status === 204 ? null : response.json();
}

function queryString(parameters: Record<string, string | number | boolean | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const serialized = query.toString();
  return serialized ? `?${serialized}` : "";
}

const ACCOUNT_PAGE_SIZE = 100;
const MAX_ACCOUNT_VOICE_PAGES = 50;

export async function getAccountVoices(signal?: AbortSignal): Promise<AccountVoice[]> {
  const voices = new Map<string, AccountVoice>();
  const seenTokens = new Set<string>();
  let nextPageToken: string | null = null;

  for (let page = 0; page < MAX_ACCOUNT_VOICE_PAGES; page += 1) {
    const payload = unwrap(await jsonRequest(
      `/api/voices/account${queryString({ pageSize: ACCOUNT_PAGE_SIZE, ...(nextPageToken ? { nextPageToken } : {}) })}`,
      signal ? { signal } : undefined,
    ));
    const pageVoices = Array.isArray(payload.voices) ? payload.voices : Array.isArray(payload.items) ? payload.items : [];
    pageVoices.map(normalizeAccountVoice).forEach((voice) => voices.set(voice.id, voice));
    const hasMore = bool(payload.hasMore ?? payload.has_more);
    if (!hasMore) return Array.from(voices.values());

    const token = text(payload.nextPageToken ?? payload.next_page_token) || null;
    if (!token || seenTokens.has(token)) {
      throw new VoiceLabApiError("ElevenLabs returned an invalid My Voices page token.", 502, "INVALID_VOICE_PAGE", false);
    }
    seenTokens.add(token);
    nextPageToken = token;
  }

  throw new VoiceLabApiError(
    `My Voices exceeded the ${MAX_ACCOUNT_VOICE_PAGES * ACCOUNT_PAGE_SIZE} voice safety limit.`,
    502,
    "VOICE_PAGE_LIMIT",
    false,
  );
}

export type SharedVoiceQuery = {
  page: number;
  pageSize: number;
  search?: string;
  language?: string;
  accent?: string;
  gender?: string;
  age?: string;
  category?: string;
  useCase?: string;
  featured?: boolean;
  sort?: string;
};

export async function getSharedVoices(parameters: SharedVoiceQuery, signal?: AbortSignal): Promise<SharedVoicePage> {
  const payload = unwrap(await jsonRequest(`/api/voices/shared${queryString(parameters)}`, signal ? { signal } : undefined));
  const voices = Array.isArray(payload.voices) ? payload.voices.map(normalizeSharedVoice) : [];
  return {
    voices,
    page: finite(payload.page, parameters.page),
    pageSize: finite(payload.pageSize ?? payload.page_size, parameters.pageSize),
    hasMore: bool(payload.hasMore ?? payload.has_more),
    totalCount: typeof (payload.totalCount ?? payload.total_count) === "number"
      ? finite(payload.totalCount ?? payload.total_count)
      : null,
  };
}

export async function addSharedVoice(voice: SharedVoice): Promise<AccountVoice> {
  const payload = unwrap(await jsonRequest(
    `/api/voices/shared/${encodeURIComponent(voice.publicOwnerId)}/${encodeURIComponent(voice.voiceId)}/add`,
    { method: "POST", body: JSON.stringify({ newName: voice.name }) },
  ));
  const voiceId = text(payload.voiceId ?? payload.voice_id);
  if (!voiceId) throw new VoiceLabApiError("ElevenLabs did not return the added Voice ID.", 502, "INVALID_VOICE_RESULT", false);
  return {
    id: voiceId,
    name: text(payload.name, voice.name),
    description: voice.description,
    category: voice.category || "Shared voice",
    previewUrl: voice.previewUrl,
    labels: Object.fromEntries([
      ["language", voice.language],
      ["accent", voice.accent],
      ["gender", voice.gender],
    ].filter((entry): entry is [string, string] => Boolean(entry[1]))),
  };
}

export function previewProxyUrl(previewUrl: string): string {
  return `/api/voices/shared/preview?${new URLSearchParams({ url: previewUrl }).toString()}`;
}

export async function generateSpeech(textValue: string, recipe: VoiceRecipe, signal?: AbortSignal): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch("/api/speech", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json", accept: "audio/*, application/json" },
      ...(signal ? { signal } : {}),
      body: JSON.stringify({
        text: textValue,
        voiceId: recipe.voiceId,
        modelId: recipe.modelId,
        ...(recipe.languageCode ? { languageCode: recipe.languageCode } : {}),
        outputFormat: recipe.outputFormat,
        ...(recipe.seed == null ? {} : { seed: recipe.seed }),
        settings: recipe.settings,
      }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new VoiceLabApiError("Voice Lab could not reach the server.", 0, "NETWORK_ERROR", true);
  }
  if (!response.ok) throw await errorFromResponse(response);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("audio/")) {
    throw new VoiceLabApiError("The server returned an invalid audio response.", 502, "INVALID_AUDIO", false);
  }
  return response.blob();
}
