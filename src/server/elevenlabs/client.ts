import { z } from "zod";
import { ProviderError } from "./errors";
import type {
  AccountVoiceList,
  AccountVoiceQuery,
  AudioStream,
  SharedVoiceList,
  SharedVoiceQuery,
  SpeechInput,
  VoiceProvider,
} from "./types";

const ELEVENLABS_API_ORIGIN = "https://api.elevenlabs.io";
export const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const MAX_JSON_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_ERROR_RESPONSE_BYTES = 4 * 1024;

const voiceSchema = z.object({
  voice_id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullish(),
  category: z.string().nullish(),
  preview_url: z.string().nullish(),
  labels: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).nullish(),
}).passthrough();

const voiceListSchema = z.object({
  voices: z.array(voiceSchema),
  has_more: z.boolean().default(false),
  next_page_token: z.string().nullish(),
  total_count: z.number().int().nonnegative().nullish(),
}).passthrough();

const stringListSchema = z.union([z.string(), z.array(z.string())]).nullish();
const verifiedLanguageSchema = z.object({
  language: z.string().nullish(),
  locale: z.string().nullish(),
}).passthrough();

const sharedVoiceSchema = z.object({
  public_owner_id: z.string().min(1),
  voice_id: z.string().min(1),
  name: z.string().min(1),
  accent: z.string().nullish(),
  gender: z.string().nullish(),
  age: z.string().nullish(),
  descriptive: stringListSchema,
  use_case: stringListSchema,
  category: z.string().nullish(),
  language: z.string().nullish(),
  locale: z.string().nullish(),
  description: z.string().nullish(),
  preview_url: z.string().nullish(),
  verified_languages: z.array(verifiedLanguageSchema).nullish(),
  featured: z.boolean().nullish(),
  free_users_allowed: z.boolean().nullish(),
  live_moderation_enabled: z.boolean().nullish(),
  rate: z.union([z.number(), z.string()]).nullish(),
}).passthrough();

const sharedVoiceListSchema = z.object({
  voices: z.array(sharedVoiceSchema),
  has_more: z.boolean().default(false),
  total_count: z.number().int().nonnegative().nullish(),
}).passthrough();

const addSharedVoiceResponseSchema = z.object({ voice_id: z.string().min(1) }).passthrough();
const errorDetailSchema = z.object({
  detail: z.object({
    code: z.string().nullish(),
    status: z.string().nullish(),
    message: z.string().nullish(),
  }).passthrough(),
}).passthrough();

function requestId(response: Response): string | undefined {
  return response.headers.get("request-id") ?? response.headers.get("x-request-id") ?? undefined;
}

function retryAfterMilliseconds(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const parsedDate = Date.parse(value);
  return Number.isNaN(parsedDate) ? null : Math.max(0, parsedDate - Date.now());
}

function publicProviderStatus(upstreamStatus: number): number {
  if (upstreamStatus >= 500) return 502;
  return upstreamStatus >= 400 && upstreamStatus <= 499 ? upstreamStatus : 502;
}

function isInvalidApiKeyResponse(value: unknown): boolean {
  const parsed = errorDetailSchema.safeParse(value);
  if (!parsed.success) return false;
  const code = parsed.data.detail.code?.trim().toLowerCase() ?? "";
  const status = parsed.data.detail.status?.trim().toLowerCase() ?? "";
  const message = parsed.data.detail.message?.trim().toLowerCase() ?? "";
  return ["invalid_api_key", "invalid_api_key_id", "invalid_xi_api_key", "api_key_id_used_as_api_key"].includes(code)
    || ["invalid_api_key", "invalid_api_key_id", "invalid_xi_api_key", "api_key_id_used_as_api_key"].includes(status)
    || /api key id.+(?:used|provided).+api key/.test(message)
    || /invalid (?:xi-)?api key/.test(message);
}

async function readBytesLimited(response: Response, maximumBytes: number): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0 || length > maximumBytes) {
      throw new ProviderError(502, "ELEVENLABS_RESPONSE_TOO_LARGE", "ElevenLabs returned a response that is too large.", {
        retryable: false,
        ...(requestId(response) ? { providerRequestId: requestId(response) } : {}),
      });
    }
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new ProviderError(502, "ELEVENLABS_RESPONSE_TOO_LARGE", "ElevenLabs returned a response that is too large.", {
        retryable: false,
        ...(requestId(response) ? { providerRequestId: requestId(response) } : {}),
      });
    }
    chunks.push(result.value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function readJsonLimited(response: Response): Promise<unknown> {
  const bytes = await readBytesLimited(response, MAX_JSON_RESPONSE_BYTES);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new ProviderError(502, "ELEVENLABS_INVALID_RESPONSE", "ElevenLabs returned an invalid JSON response.", {
      retryable: false,
      ...(requestId(response) ? { providerRequestId: requestId(response) } : {}),
    });
  }
}

async function readErrorJson(response: Response): Promise<unknown> {
  try {
    const bytes = await readBytesLimited(response, MAX_ERROR_RESPONSE_BYTES);
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }
}

function normalizeStringList(value: string | string[] | null | undefined): string[] {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

export function safeElevenLabsPreviewUrl(value: string | null | undefined): string | null {
  if (!value || value.length > 3_000) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:"
      || url.hostname !== "storage.googleapis.com"
      || url.port
      || url.username
      || url.password
      || url.hash
      || !url.pathname.startsWith("/eleven-public-prod/")
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function validRangeHeader(value: string): boolean {
  if (value.length > 80) return false;
  const match = /^bytes=(?:(\d+)-(\d*)|-(\d+))$/.exec(value);
  if (!match) return false;
  const start = match[1] ? Number(match[1]) : null;
  const end = match[2] ? Number(match[2]) : null;
  const suffix = match[3] ? Number(match[3]) : null;
  if (start != null && (!Number.isSafeInteger(start) || start < 0)) return false;
  if (end != null && (!Number.isSafeInteger(end) || end < (start ?? 0))) return false;
  return suffix == null || (Number.isSafeInteger(suffix) && suffix > 0);
}

type ParsedContentRange = { start: number; end: number; total: number | null };

function parseContentRange(value: string | null): ParsedContentRange | null {
  if (!value) return null;
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(value);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = match[3] === "*" ? null : Number(match[3]);
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(end)
    || start < 0
    || end < start
    || (total != null && (!Number.isSafeInteger(total) || total <= end))
  ) return null;
  return { start, end, total };
}

function rangeResponseMatches(requested: string, returned: ParsedContentRange): boolean {
  const match = /^bytes=(?:(\d+)-(\d*)|-(\d+))$/.exec(requested);
  if (!match) return false;
  if (match[3]) {
    const suffix = Number(match[3]);
    return returned.total != null
      && returned.end === returned.total - 1
      && returned.end - returned.start + 1 <= suffix;
  }
  const requestedStart = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : null;
  return returned.start === requestedStart && (requestedEnd == null || returned.end <= requestedEnd);
}

function bytesEqual(value: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((byte, index) => value[offset + index] === byte);
}

function audioMimeFromSignature(audio: Uint8Array): string | null {
  if (
    audio.byteLength >= 12
    && bytesEqual(audio, 0, [0x52, 0x49, 0x46, 0x46])
    && bytesEqual(audio, 8, [0x57, 0x41, 0x56, 0x45])
  ) return "audio/wav";
  if (audio.byteLength >= 4 && bytesEqual(audio, 0, [0x4f, 0x67, 0x67, 0x53])) return "audio/ogg";
  if (audio.byteLength >= 8 && bytesEqual(audio, 4, [0x66, 0x74, 0x79, 0x70])) return "audio/mp4";
  if (audio.byteLength >= 3 && bytesEqual(audio, 0, [0x49, 0x44, 0x33])) return "audio/mpeg";
  if (audio.byteLength >= 2 && audio[0] === 0xff && ((audio[1] ?? 0) & 0xe0) === 0xe0) return "audio/mpeg";
  if (audio.byteLength >= 2 && audio[0] === 0xff && ((audio[1] ?? 0) & 0xf6) === 0xf0) return "audio/aac";
  return null;
}

function previewMimeFromPath(previewUrl: string): string | null {
  const path = new URL(previewUrl).pathname.toLowerCase();
  if (path.endsWith(".mp3")) return "audio/mpeg";
  if (path.endsWith(".wav")) return "audio/wav";
  if (path.endsWith(".ogg") || path.endsWith(".opus")) return "audio/ogg";
  if (path.endsWith(".m4a") || path.endsWith(".mp4")) return "audio/mp4";
  if (path.endsWith(".aac")) return "audio/aac";
  return null;
}

function normalizeAudioMime(value: string | null): string | null {
  const mime = value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const aliases: Record<string, string> = {
    "audio/mp3": "audio/mpeg",
    "audio/x-mpeg": "audio/mpeg",
    "audio/x-wav": "audio/wav",
    "audio/wave": "audio/wav",
  };
  const normalized = aliases[mime] ?? mime;
  return ["audio/mpeg", "audio/wav", "audio/ogg", "audio/mp4", "audio/aac", "audio/pcm", "audio/basic"].includes(normalized)
    ? normalized
    : null;
}

async function prepareCappedAudioStream(
  response: Response,
  options: { previewUrl?: string; startsAtBeginning: boolean; expectedMime?: string },
): Promise<{ stream: ReadableStream<Uint8Array>; mimeType: string; contentLength: number | null }> {
  const declaredHeader = response.headers.get("content-length");
  const declared = declaredHeader == null ? null : Number(declaredHeader);
  if (declared != null && (!Number.isSafeInteger(declared) || declared <= 0 || declared > MAX_AUDIO_BYTES)) {
    throw new ProviderError(502, "ELEVENLABS_AUDIO_TOO_LARGE", "ElevenLabs returned audio that is too large to proxy safely.", {
      retryable: false,
      ...(requestId(response) ? { providerRequestId: requestId(response) } : {}),
    });
  }
  if (!response.body) {
    throw new ProviderError(502, "ELEVENLABS_EMPTY_AUDIO", "ElevenLabs returned an empty audio response.", {
      retryable: true,
      ...(requestId(response) ? { providerRequestId: requestId(response) } : {}),
    });
  }

  const reader = response.body.getReader();
  const prefix: Uint8Array[] = [];
  let total = 0;
  let prefixBytes = 0;
  while (prefixBytes < 16) {
    const result = await reader.read();
    if (result.done) break;
    if (result.value.byteLength === 0) continue;
    total += result.value.byteLength;
    prefixBytes += result.value.byteLength;
    if (total > MAX_AUDIO_BYTES) {
      await reader.cancel();
      throw new ProviderError(502, "ELEVENLABS_AUDIO_TOO_LARGE", "ElevenLabs returned audio that is too large to proxy safely.", {
        retryable: false,
      });
    }
    prefix.push(result.value);
  }
  if (total === 0) {
    throw new ProviderError(502, "ELEVENLABS_EMPTY_AUDIO", "ElevenLabs returned an empty audio response.", {
      retryable: true,
      ...(requestId(response) ? { providerRequestId: requestId(response) } : {}),
    });
  }
  const sample = new Uint8Array(prefixBytes);
  let sampleOffset = 0;
  for (const chunk of prefix) {
    sample.set(chunk, sampleOffset);
    sampleOffset += chunk.byteLength;
  }

  const contentTypeHeader = response.headers.get("content-type");
  let mimeType = normalizeAudioMime(contentTypeHeader);
  if (!mimeType) {
    const rawMime = contentTypeHeader?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    if (rawMime !== "application/octet-stream" && rawMime !== "text/plain") {
      await reader.cancel();
      throw new ProviderError(502, "ELEVENLABS_INVALID_AUDIO", "ElevenLabs did not return a supported audio file.", {
        retryable: false,
        ...(requestId(response) ? { providerRequestId: requestId(response) } : {}),
      });
    }
    if (!options.startsAtBeginning) mimeType = options.previewUrl ? previewMimeFromPath(options.previewUrl) : options.expectedMime ?? null;
    else mimeType = audioMimeFromSignature(sample);
  }
  if (!mimeType || (options.expectedMime && mimeType !== options.expectedMime)) {
    await reader.cancel();
    throw new ProviderError(502, "ELEVENLABS_INVALID_AUDIO", "ElevenLabs did not return the requested audio format.", {
      retryable: false,
      ...(requestId(response) ? { providerRequestId: requestId(response) } : {}),
    });
  }

  let prefixIndex = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (prefixIndex < prefix.length) {
        controller.enqueue(prefix[prefixIndex] as Uint8Array);
        prefixIndex += 1;
        return;
      }
      try {
        const result = await reader.read();
        if (result.done) {
          controller.close();
          return;
        }
        total += result.value.byteLength;
        if (total > MAX_AUDIO_BYTES) {
          await reader.cancel();
          controller.error(new Error("Audio stream exceeded the safe response limit."));
          return;
        }
        controller.enqueue(result.value);
      } catch {
        controller.error(new Error("The upstream audio stream ended unexpectedly."));
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });

  return { stream, mimeType, contentLength: declared };
}

export type ElevenLabsClientOptions = {
  apiKey: string;
  fetch?: typeof fetch;
  apiOrigin?: string;
};

export class ElevenLabsClient implements VoiceProvider {
  readonly name = "elevenlabs" as const;
  private readonly fetcher: typeof fetch;
  private readonly apiOrigin: string;

  constructor(private readonly options: ElevenLabsClientOptions) {
    this.fetcher = options.fetch ?? fetch;
    this.apiOrigin = options.apiOrigin ?? ELEVENLABS_API_ORIGIN;
  }

  private async request(path: string, init: RequestInit, authenticated: boolean): Promise<Response> {
    if (authenticated && !this.options.apiKey) {
      throw new ProviderError(503, "ELEVENLABS_NOT_CONFIGURED", "ElevenLabs is not configured on this server.", { retryable: false });
    }
    const headers = new Headers(init.headers);
    if (authenticated) headers.set("xi-api-key", this.options.apiKey);
    else headers.delete("xi-api-key");
    let response: Response;
    try {
      response = await this.fetcher(`${this.apiOrigin}${path}`, {
        ...init,
        headers,
        redirect: "manual",
        signal: init.signal ?? AbortSignal.timeout(60_000),
      });
    } catch {
      throw new ProviderError(503, "ELEVENLABS_NETWORK_ERROR", "Could not reach ElevenLabs.", { retryable: true });
    }
    if (response.status >= 300 && response.status < 400) {
      throw new ProviderError(502, "ELEVENLABS_UNEXPECTED_REDIRECT", "ElevenLabs returned an unexpected redirect.", {
        retryable: false,
        ...(requestId(response) ? { providerRequestId: requestId(response) } : {}),
      });
    }
    if (response.ok) return response;
    const errorBody = await readErrorJson(response);
    if (isInvalidApiKeyResponse(errorBody)) {
      throw new ProviderError(401, "ELEVENLABS_INVALID_API_KEY", "ElevenLabs rejected the configured API key.", {
        retryable: false,
        ...(requestId(response) ? { providerRequestId: requestId(response) } : {}),
      });
    }
    const retryable = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;
    throw new ProviderError(
      publicProviderStatus(response.status),
      `ELEVENLABS_${response.status}`,
      `ElevenLabs returned HTTP ${response.status}.`,
      {
        retryable,
        retryAfterMs: retryAfterMilliseconds(response.headers.get("retry-after")),
        ...(requestId(response) ? { providerRequestId: requestId(response) } : {}),
      },
    );
  }

  async listAccountVoices(query: AccountVoiceQuery): Promise<AccountVoiceList> {
    const search = new URLSearchParams({
      page_size: String(query.pageSize),
      include_total_count: "true",
    });
    if (query.search) search.set("search", query.search);
    if (query.nextPageToken) search.set("next_page_token", query.nextPageToken);
    if (query.voiceType) search.set("voice_type", query.voiceType);
    if (query.category) search.set("category", query.category);
    const response = await this.request(`/v2/voices?${search.toString()}`, { headers: { accept: "application/json" } }, true);
    const parsed = voiceListSchema.safeParse(await readJsonLimited(response));
    if (!parsed.success) {
      throw new ProviderError(502, "ELEVENLABS_INVALID_RESPONSE", "ElevenLabs returned an invalid voice-list response.", {
        retryable: false,
        ...(requestId(response) ? { providerRequestId: requestId(response) } : {}),
      });
    }
    return {
      voices: parsed.data.voices.map((voice) => ({
        id: voice.voice_id,
        name: voice.name,
        description: voice.description ?? "",
        category: voice.category ?? "",
        previewUrl: safeElevenLabsPreviewUrl(voice.preview_url),
        labels: Object.fromEntries(Object.entries(voice.labels ?? {}).map(([key, value]) => [key, String(value)])),
        source: "account" as const,
      })),
      hasMore: parsed.data.has_more,
      nextPageToken: parsed.data.next_page_token ?? null,
      totalCount: parsed.data.total_count ?? null,
    };
  }

  async listSharedVoices(query: SharedVoiceQuery): Promise<SharedVoiceList> {
    const search = new URLSearchParams({ page: String(query.page), page_size: String(query.pageSize) });
    const scalar: Array<[string, string | number | undefined]> = [
      ["search", query.search], ["category", query.category], ["gender", query.gender], ["age", query.age],
      ["accent", query.accent], ["language", query.language], ["locale", query.locale],
      ["min_notice_period_days", query.minNoticePeriodDays], ["owner_id", query.ownerId], ["sort", query.sort],
    ];
    for (const [key, value] of scalar) if (value !== undefined) search.set(key, String(value));
    const booleans: Array<[string, boolean | undefined]> = [
      ["featured", query.featured], ["include_custom_rates", query.includeCustomRates],
      ["include_live_moderated", query.includeLiveModerated], ["reader_app_enabled", query.readerAppEnabled],
    ];
    for (const [key, value] of booleans) if (value !== undefined) search.set(key, String(value));
    for (const value of query.useCases ?? []) search.append("use_cases", value);
    for (const value of query.descriptives ?? []) search.append("descriptives", value);
    const response = await this.request(
      `/v1/shared-voices?${search.toString()}`,
      { headers: { accept: "application/json" } },
      Boolean(this.options.apiKey),
    );
    const parsed = sharedVoiceListSchema.safeParse(await readJsonLimited(response));
    if (!parsed.success) {
      throw new ProviderError(502, "ELEVENLABS_INVALID_RESPONSE", "ElevenLabs returned an invalid Shared Voice Library response.", {
        retryable: false,
        ...(requestId(response) ? { providerRequestId: requestId(response) } : {}),
      });
    }
    return {
      voices: parsed.data.voices.map((voice) => {
        const verified = voice.verified_languages ?? [];
        const parsedRate = typeof voice.rate === "string" ? Number(voice.rate) : voice.rate;
        return {
          publicOwnerId: voice.public_owner_id,
          voiceId: voice.voice_id,
          name: voice.name,
          accent: voice.accent ?? "",
          gender: voice.gender ?? "",
          age: voice.age ?? "",
          descriptive: normalizeStringList(voice.descriptive),
          useCase: normalizeStringList(voice.use_case),
          category: voice.category ?? "",
          language: voice.language ?? verified[0]?.language ?? "",
          locale: voice.locale ?? verified.find((entry) => entry.locale)?.locale ?? null,
          description: voice.description ?? null,
          previewUrl: safeElevenLabsPreviewUrl(voice.preview_url),
          verifiedLanguages: normalizeStringList(verified.map((entry) => entry.language ?? "")),
          featured: voice.featured ?? false,
          freeUsersAllowed: voice.free_users_allowed ?? false,
          liveModerationEnabled: voice.live_moderation_enabled ?? false,
          rate: parsedRate != null && Number.isFinite(parsedRate) ? parsedRate : null,
        };
      }),
      page: query.page,
      pageSize: query.pageSize,
      hasMore: parsed.data.has_more,
      totalCount: parsed.data.total_count ?? parsed.data.voices.length,
    };
  }

  async addSharedVoice(
    publicOwnerId: string,
    voiceId: string,
    input: { newName: string; bookmarked?: boolean },
  ): Promise<{ voiceId: string }> {
    const response = await this.request(
      `/v1/voices/add/${encodeURIComponent(publicOwnerId)}/${encodeURIComponent(voiceId)}`,
      {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({
          new_name: input.newName,
          ...(input.bookmarked !== undefined ? { bookmarked: input.bookmarked } : {}),
        }),
      },
      true,
    );
    const parsed = addSharedVoiceResponseSchema.safeParse(await readJsonLimited(response));
    if (!parsed.success) {
      throw new ProviderError(502, "ELEVENLABS_INVALID_RESPONSE", "ElevenLabs returned an invalid add-voice response.", {
        retryable: false,
        ...(requestId(response) ? { providerRequestId: requestId(response) } : {}),
      });
    }
    return { voiceId: parsed.data.voice_id };
  }

  async previewSharedVoice(previewUrl: string, range?: string): Promise<AudioStream> {
    const safeUrl = safeElevenLabsPreviewUrl(previewUrl);
    if (!safeUrl) {
      throw new ProviderError(400, "UNSAFE_SHARED_VOICE_PREVIEW_URL", "The preview URL is not an approved ElevenLabs audio URL.", {
        retryable: false,
      });
    }
    if (range && !validRangeHeader(range)) {
      throw new ProviderError(416, "INVALID_RANGE", "The requested audio byte range is invalid.", { retryable: false });
    }
    const headers = new Headers({ accept: "audio/*" });
    if (range) headers.set("range", range);
    let response: Response;
    try {
      response = await this.fetcher(safeUrl, {
        method: "GET",
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new ProviderError(503, "ELEVENLABS_NETWORK_ERROR", "Could not load the ElevenLabs voice preview.", { retryable: true });
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProviderError(502, "ELEVENLABS_PREVIEW_REDIRECT", "The voice preview attempted an unsafe redirect.", { retryable: false });
    }
    if (!response.ok || (response.status !== 200 && response.status !== 206)) {
      await response.body?.cancel().catch(() => undefined);
      throw new ProviderError(publicProviderStatus(response.status), `ELEVENLABS_PREVIEW_${response.status}`, `ElevenLabs returned HTTP ${response.status} for the voice preview.`, {
        retryable: response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500,
        retryAfterMs: retryAfterMilliseconds(response.headers.get("retry-after")),
        ...(requestId(response) ? { providerRequestId: requestId(response) } : {}),
      });
    }
    const parsedContentRange = parseContentRange(response.headers.get("content-range"));
    if (
      response.status === 206
      && (!range || !parsedContentRange || !rangeResponseMatches(range, parsedContentRange))
    ) {
      response.body?.cancel().catch(() => undefined);
      throw new ProviderError(502, "ELEVENLABS_INVALID_AUDIO_RANGE", "ElevenLabs returned an invalid audio byte range.", { retryable: false });
    }
    const startsAtBeginning = response.status === 200 || parsedContentRange?.start === 0;
    const audio = await prepareCappedAudioStream(response, { previewUrl: safeUrl, startsAtBeginning });
    if (
      parsedContentRange
      && audio.contentLength != null
      && audio.contentLength !== parsedContentRange.end - parsedContentRange.start + 1
    ) {
      await audio.stream.cancel().catch(() => undefined);
      throw new ProviderError(502, "ELEVENLABS_INVALID_AUDIO_RANGE", "ElevenLabs returned an invalid audio byte range.", { retryable: false });
    }
    return {
      ...audio,
      status: response.status,
      acceptRanges: response.headers.get("accept-ranges")?.toLowerCase() === "bytes" ? "bytes" : null,
      contentRange: response.status === 206 ? response.headers.get("content-range") : null,
      providerRequestId: requestId(response) ?? null,
      characterCost: null,
    };
  }

  async synthesize(input: SpeechInput): Promise<AudioStream> {
    const search = new URLSearchParams({ output_format: input.outputFormat });
    const response = await this.request(
      `/v1/text-to-speech/${encodeURIComponent(input.voiceId)}?${search.toString()}`,
      {
        method: "POST",
        headers: { accept: "audio/mpeg", "content-type": "application/json" },
        body: JSON.stringify({
          text: input.text,
          model_id: input.modelId,
          ...(input.languageCode ? { language_code: input.languageCode } : {}),
          ...(input.seed !== undefined ? { seed: input.seed } : {}),
          voice_settings: {
            stability: input.settings.stability,
            similarity_boost: input.settings.similarityBoost,
            style: input.settings.style,
            speed: input.settings.speed,
            use_speaker_boost: input.settings.useSpeakerBoost,
          },
        }),
      },
      true,
    );
    const audio = await prepareCappedAudioStream(response, { startsAtBeginning: true, expectedMime: "audio/mpeg" });
    const rawCost = response.headers.get("character-cost");
    const cost = rawCost?.trim() ? Number(rawCost) : Number.NaN;
    return {
      ...audio,
      status: 200,
      acceptRanges: null,
      contentRange: null,
      providerRequestId: requestId(response) ?? null,
      characterCost: Number.isFinite(cost) && cost >= 0 ? cost : null,
    };
  }
}
