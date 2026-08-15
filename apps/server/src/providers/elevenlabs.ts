import { z } from "zod";
import { redactSecrets } from "../logger.js";
import type {
  ProviderUsage,
  SharedVoiceListResult,
  SharedVoicePreview,
  SharedVoiceQuery,
  SynthesizeInput,
  SynthesizeResult,
  TtsProvider,
  VoiceListQuery,
  VoiceListResult,
} from "./types.js";
import { ProviderError } from "./types.js";

const voiceSchema = z.object({
  voice_id: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  category: z.string().nullish(),
  preview_url: z.string().url().nullish(),
  labels: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).nullish(),
});

const voiceListSchema = z.object({
  voices: z.array(voiceSchema),
  has_more: z.boolean().default(false),
  next_page_token: z.string().nullish(),
  total_count: z.number().int().nullish(),
});

const stringListSchema = z.union([z.string(), z.array(z.string())]).nullish();

const verifiedLanguageSchema = z.object({
  language: z.string().nullish(),
  locale: z.string().nullish(),
}).passthrough();

const sharedVoiceSchema = z.object({
  public_owner_id: z.string(),
  voice_id: z.string(),
  name: z.string(),
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

const addSharedVoiceSchema = z.object({ voice_id: z.string().min(1) }).passthrough();

const elevenLabsErrorBodySchema = z.object({
  detail: z.object({
    code: z.string().nullish(),
    status: z.string().nullish(),
    message: z.string().nullish(),
  }).passthrough(),
}).passthrough();

const subscriptionSchema = z.object({
  tier: z.string().nullish(),
  character_count: z.number().int().nonnegative().nullish(),
  character_limit: z.number().int().nonnegative().nullish(),
  next_character_count_reset_unix: z.number().int().nullish(),
});

function retryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

function requestId(response: Response): string | undefined {
  return response.headers.get("request-id") ?? response.headers.get("x-request-id") ?? undefined;
}

function classifyStatus(status: number): { retryable: boolean; concurrencyLimited: boolean } {
  return {
    retryable: status === 408 || status === 425 || status === 429 || status >= 500,
    concurrencyLimited: status === 429,
  };
}

function sanitizedProviderErrorBody(rawBody: string, apiKey: string): unknown {
  try {
    return redactSecrets(JSON.parse(rawBody) as unknown, [apiKey]);
  } catch {
    return redactSecrets(rawBody, [apiKey]);
  }
}

function isInvalidApiKeyError(value: unknown): boolean {
  const parsed = elevenLabsErrorBodySchema.safeParse(value);
  if (!parsed.success) return false;
  const code = parsed.data.detail.code?.trim().toLowerCase() ?? "";
  const status = parsed.data.detail.status?.trim().toLowerCase() ?? "";
  const message = parsed.data.detail.message?.trim().toLowerCase() ?? "";
  const markers = new Set([
    "invalid_api_key",
    "invalid_api_key_id",
    "invalid_xi_api_key",
    "api_key_id_used_as_api_key",
  ]);
  return markers.has(code)
    || markers.has(status)
    || /api key id.+(?:used|provided).+api key/.test(message)
    || /invalid (?:xi-)?api key/.test(message);
}

function extensionFor(format: string, contentType: string): string {
  if (contentType.includes("wav")) return "wav";
  if (contentType.includes("mpeg") || format.startsWith("mp3")) return "mp3";
  if (contentType.includes("ogg") || format.startsWith("opus")) return "ogg";
  if (format.startsWith("pcm")) return "pcm";
  if (format.startsWith("ulaw")) return "ulaw";
  return "bin";
}

const MAX_SHARED_PREVIEW_BYTES = 12 * 1024 * 1024;

function normalizeStringList(value: string | string[] | null | undefined): string[] {
  const candidates = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(candidates.map((item) => item.trim()).filter(Boolean))];
}

function safeSharedPreviewUrl(value: string | null | undefined): string | null {
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

type PreviewAudioFormat = {
  extension: "mp3" | "wav" | "ogg" | "opus" | "m4a" | "mp4" | "aac";
  mimeType: string;
};

function previewAudioFormat(previewUrl: string): PreviewAudioFormat | null {
  const pathname = new URL(previewUrl).pathname.toLowerCase();
  if (pathname.endsWith(".mp3")) return { extension: "mp3", mimeType: "audio/mpeg" };
  if (pathname.endsWith(".wav")) return { extension: "wav", mimeType: "audio/wav" };
  if (pathname.endsWith(".ogg")) return { extension: "ogg", mimeType: "audio/ogg" };
  if (pathname.endsWith(".opus")) return { extension: "opus", mimeType: "audio/ogg" };
  if (pathname.endsWith(".m4a")) return { extension: "m4a", mimeType: "audio/mp4" };
  if (pathname.endsWith(".mp4")) return { extension: "mp4", mimeType: "audio/mp4" };
  if (pathname.endsWith(".aac")) return { extension: "aac", mimeType: "audio/aac" };
  return null;
}

function bytesEqual(audio: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((byte, index) => audio[offset + index] === byte);
}

function previewMimeTypeFromSignature(audio: Uint8Array): string | null {
  if (
    audio.byteLength >= 12
    && bytesEqual(audio, 0, [0x52, 0x49, 0x46, 0x46])
    && bytesEqual(audio, 8, [0x57, 0x41, 0x56, 0x45])
  ) return "audio/wav";
  if (audio.byteLength >= 4 && bytesEqual(audio, 0, [0x4f, 0x67, 0x67, 0x53])) return "audio/ogg";
  if (audio.byteLength >= 8 && bytesEqual(audio, 4, [0x66, 0x74, 0x79, 0x70])) return "audio/mp4";
  if (audio.byteLength >= 3 && bytesEqual(audio, 0, [0x49, 0x44, 0x33])) return "audio/mpeg";
  if (
    audio.byteLength >= 2
    && audio[0] === 0xff
    && ((audio[1] ?? 0) & 0xe0) === 0xe0
    && (((audio[1] ?? 0) >> 3) & 0x03) !== 0x01
    && (((audio[1] ?? 0) >> 1) & 0x03) !== 0
  ) return "audio/mpeg";
  if (audio.byteLength >= 2 && audio[0] === 0xff && ((audio[1] ?? 0) & 0xf6) === 0xf0) return "audio/aac";
  return null;
}

function previewMimeType(
  contentType: string | null,
  previewUrl: string,
  audio: Uint8Array,
  startsAtBeginning: boolean,
): string | null {
  const normalized = contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (normalized.startsWith("audio/")) return normalized;
  if (normalized !== "application/octet-stream" && normalized !== "text/plain") return null;
  const format = previewAudioFormat(previewUrl);
  if (!format) return null;
  if (!startsAtBeginning) return format.mimeType;
  return previewMimeTypeFromSignature(audio);
}

async function readLimitedAudio(response: Response): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0 || declaredLength > MAX_SHARED_PREVIEW_BYTES) {
      throw new ProviderError(502, "ELEVENLABS_PREVIEW_TOO_LARGE", "The Shared Voice preview is too large to proxy safely.", { retryable: false });
    }
  }
  if (!response.body) {
    throw new ProviderError(502, "ELEVENLABS_EMPTY_AUDIO", "ElevenLabs returned an empty Shared Voice preview.", { retryable: true });
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > MAX_SHARED_PREVIEW_BYTES) {
      await reader.cancel();
      throw new ProviderError(502, "ELEVENLABS_PREVIEW_TOO_LARGE", "The Shared Voice preview is too large to proxy safely.", { retryable: false });
    }
    chunks.push(chunk.value);
  }
  if (total === 0) {
    throw new ProviderError(502, "ELEVENLABS_EMPTY_AUDIO", "ElevenLabs returned an empty Shared Voice preview.", { retryable: true });
  }
  const audio = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    audio.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return audio;
}

export type ElevenLabsProviderOptions = {
  apiKey: string;
  baseUrl: string;
  fetch?: typeof fetch;
};

export class ElevenLabsTtsProvider implements TtsProvider {
  readonly name = "elevenlabs" as const;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: ElevenLabsProviderOptions) {
    this.fetcher = options.fetch ?? fetch;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    if (!this.options.apiKey) {
      throw new ProviderError(400, "ELEVENLABS_NOT_CONFIGURED", "ELEVENLABS_API_KEY is not configured.", { retryable: false });
    }
    try {
      const headers = new Headers(init.headers);
      headers.set("xi-api-key", this.options.apiKey);
      const response = await this.fetcher(`${this.options.baseUrl}${path}`, {
        ...init,
        headers,
        signal: init.signal ?? AbortSignal.timeout(60_000),
      });
      if (response.ok) return response;
      const rawBody = (await response.text()).slice(0, 2_000);
      const sanitizedBody = sanitizedProviderErrorBody(rawBody, this.options.apiKey);
      if (isInvalidApiKeyError(sanitizedBody)) {
        throw new ProviderError(
          response.status,
          "ELEVENLABS_INVALID_API_KEY",
          "ElevenLabs rejected ELEVENLABS_API_KEY. Use the secret API key value that starts with sk_, not the API key ID, then restart the app.",
          {
            retryable: false,
            ...(requestId(response) ? { providerRequestId: requestId(response) } : {}),
          },
        );
      }
      const classification = classifyStatus(response.status);
      throw new ProviderError(
        response.status,
        `ELEVENLABS_${response.status}`,
        `ElevenLabs returned HTTP ${response.status}.`,
        {
          retryable: classification.retryable,
          concurrencyLimited: classification.concurrencyLimited,
          retryAfterMs: retryAfterMs(response.headers.get("retry-after")),
          ...(requestId(response) ? { providerRequestId: requestId(response) } : {}),
          details: { response: sanitizedBody },
        },
      );
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      const message = error instanceof Error ? error.message : "Unknown network error";
      throw new ProviderError(503, "ELEVENLABS_NETWORK_ERROR", "Could not reach ElevenLabs.", {
        retryable: true,
        details: { cause: redactSecrets(message, [this.options.apiKey]) },
      });
    }
  }

  private async anonymousRequest(path: string, init: RequestInit = {}): Promise<Response> {
    try {
      const headers = new Headers(init.headers);
      headers.delete("xi-api-key");
      const response = await this.fetcher(`${this.options.baseUrl}${path}`, {
        ...init,
        headers,
        signal: init.signal ?? AbortSignal.timeout(60_000),
      });
      if (response.ok) return response;
      const rawBody = (await response.text()).slice(0, 2_000);
      if (response.status === 401 || response.status === 403) {
        throw new ProviderError(
          response.status,
          "ELEVENLABS_SHARED_LIBRARY_AUTH_REQUIRED",
          "ElevenLabs requires ELEVENLABS_API_KEY for Shared Voice Library browsing on this connection.",
          {
            retryable: false,
            ...(requestId(response) ? { providerRequestId: requestId(response) } : {}),
          },
        );
      }
      const classification = classifyStatus(response.status);
      throw new ProviderError(
        response.status,
        `ELEVENLABS_${response.status}`,
        `ElevenLabs returned HTTP ${response.status} while browsing the Shared Voice Library.`,
        {
          retryable: classification.retryable,
          concurrencyLimited: classification.concurrencyLimited,
          retryAfterMs: retryAfterMs(response.headers.get("retry-after")),
          ...(requestId(response) ? { providerRequestId: requestId(response) } : {}),
          details: { response: redactSecrets(rawBody, [this.options.apiKey]) },
        },
      );
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      const message = error instanceof Error ? error.message : "Unknown network error";
      throw new ProviderError(503, "ELEVENLABS_NETWORK_ERROR", "Could not reach the ElevenLabs Shared Voice Library.", {
        retryable: true,
        details: { cause: redactSecrets(message, [this.options.apiKey]) },
      });
    }
  }

  private async subscription(): Promise<z.infer<typeof subscriptionSchema>> {
    const response = await this.request("/v1/user/subscription");
    const parsed = subscriptionSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new ProviderError(502, "ELEVENLABS_INVALID_RESPONSE", "ElevenLabs returned an invalid subscription response.", {
        retryable: false,
        ...(requestId(response) ? { providerRequestId: requestId(response) } : {}),
      });
    }
    return parsed.data;
  }

  async testConnection(): Promise<{ ok: true; account: { tier: string | null } }> {
    const subscription = await this.subscription();
    return { ok: true, account: { tier: subscription.tier ?? null } };
  }

  async listAccountVoices(query: VoiceListQuery): Promise<VoiceListResult> {
    const search = new URLSearchParams();
    search.set("page_size", String(Math.min(100, Math.max(1, query.pageSize ?? 50))));
    search.set("include_total_count", "true");
    if (query.search) search.set("search", query.search);
    if (query.nextPageToken) search.set("next_page_token", query.nextPageToken);
    if (query.voiceType) search.set("voice_type", query.voiceType);
    if (query.category) search.set("category", query.category);
    const response = await this.request(`/v2/voices?${search.toString()}`);
    const parsed = voiceListSchema.safeParse(await response.json());
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
        previewUrl: voice.preview_url ?? null,
        labels: Object.fromEntries(Object.entries(voice.labels ?? {}).map(([key, value]) => [key, String(value)])),
        source: "account" as const,
      })),
      hasMore: parsed.data.has_more,
      nextPageToken: parsed.data.next_page_token ?? null,
      totalCount: parsed.data.total_count ?? null,
    };
  }

  async listSharedVoices(query: SharedVoiceQuery): Promise<SharedVoiceListResult> {
    const page = Math.max(0, query.page ?? 0);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 24));
    const search = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    const scalarFilters: Array<[string, string | number | undefined]> = [
      ["search", query.search],
      ["category", query.category],
      ["gender", query.gender],
      ["age", query.age],
      ["accent", query.accent],
      ["language", query.language],
      ["locale", query.locale],
      ["min_notice_period_days", query.minNoticePeriodDays],
      ["owner_id", query.ownerId],
      ["sort", query.sort],
    ];
    for (const [key, value] of scalarFilters) {
      if (value !== undefined) search.set(key, String(value));
    }
    const booleanFilters: Array<[string, boolean | undefined]> = [
      ["featured", query.featured],
      ["include_custom_rates", query.includeCustomRates],
      ["include_live_moderated", query.includeLiveModerated],
      ["reader_app_enabled", query.readerAppEnabled],
    ];
    for (const [key, value] of booleanFilters) {
      if (value !== undefined) search.set(key, String(value));
    }
    for (const value of query.useCases ?? []) search.append("use_cases", value);
    for (const value of query.descriptives ?? []) search.append("descriptives", value);

    const sharedLibraryRequest = this.options.apiKey ? this.request.bind(this) : this.anonymousRequest.bind(this);
    const response = await sharedLibraryRequest(`/v1/shared-voices?${search.toString()}`, {
      headers: { accept: "application/json" },
    });
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ProviderError(502, "ELEVENLABS_INVALID_RESPONSE", "ElevenLabs returned an invalid Shared Voice Library response.", {
        retryable: false,
        ...(requestId(response) ? { providerRequestId: requestId(response) } : {}),
      });
    }
    const parsed = sharedVoiceListSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ProviderError(502, "ELEVENLABS_INVALID_RESPONSE", "ElevenLabs returned an invalid Shared Voice Library response.", {
        retryable: false,
        ...(requestId(response) ? { providerRequestId: requestId(response) } : {}),
      });
    }
    return {
      voices: parsed.data.voices.map((voice) => {
        const verifiedLanguages = voice.verified_languages ?? [];
        const rate = typeof voice.rate === "string" ? Number(voice.rate) : voice.rate;
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
          language: voice.language ?? verifiedLanguages[0]?.language ?? "",
          locale: voice.locale ?? verifiedLanguages.find((entry) => entry.locale)?.locale ?? null,
          description: voice.description ?? null,
          previewUrl: safeSharedPreviewUrl(voice.preview_url),
          verifiedLanguages: normalizeStringList(verifiedLanguages.map((entry) => entry.language ?? "")),
          featured: voice.featured ?? false,
          freeUsersAllowed: voice.free_users_allowed ?? false,
          liveModerationEnabled: voice.live_moderation_enabled ?? false,
          rate: rate != null && Number.isFinite(rate) ? rate : null,
        };
      }),
      page,
      pageSize,
      hasMore: parsed.data.has_more,
      totalCount: parsed.data.total_count ?? parsed.data.voices.length,
    };
  }

  async addSharedVoice(
    publicOwnerId: string,
    voiceId: string,
    input: { newName: string; bookmarked?: boolean },
  ): Promise<{ voiceId: string }> {
    if (!this.options.apiKey) {
      throw new ProviderError(
        400,
        "ELEVENLABS_NOT_CONFIGURED",
        "Adding a Shared Voice to your account requires ELEVENLABS_API_KEY.",
        { retryable: false },
      );
    }
    const response = await this.request(
      `/v1/voices/add/${encodeURIComponent(publicOwnerId)}/${encodeURIComponent(voiceId)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          new_name: input.newName,
          ...(input.bookmarked !== undefined ? { bookmarked: input.bookmarked } : {}),
        }),
      },
    );
    const parsed = addSharedVoiceSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new ProviderError(502, "ELEVENLABS_INVALID_RESPONSE", "ElevenLabs returned an invalid add-voice response.", {
        retryable: false,
        ...(requestId(response) ? { providerRequestId: requestId(response) } : {}),
      });
    }
    return { voiceId: parsed.data.voice_id };
  }

  async fetchSharedVoicePreview(previewUrl: string, range?: string): Promise<SharedVoicePreview> {
    const safeUrl = safeSharedPreviewUrl(previewUrl);
    if (!safeUrl) {
      throw new ProviderError(400, "UNSAFE_SHARED_VOICE_PREVIEW_URL", "The Shared Voice preview URL is not an approved ElevenLabs audio URL.", {
        retryable: false,
      });
    }
    if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) {
      throw new ProviderError(416, "INVALID_RANGE", "The requested audio byte range is invalid.", { retryable: false });
    }
    try {
      const headers = new Headers({ accept: "audio/*" });
      if (range) headers.set("range", range);
      headers.delete("xi-api-key");
      const response = await this.fetcher(safeUrl, {
        method: "GET",
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status >= 300 && response.status < 400) {
        throw new ProviderError(502, "ELEVENLABS_PREVIEW_REDIRECT", "The Shared Voice preview attempted an unsafe redirect.", { retryable: false });
      }
      if (!response.ok || (response.status !== 200 && response.status !== 206)) {
        const classification = classifyStatus(response.status);
        throw new ProviderError(
          response.status >= 400 && response.status <= 599 ? response.status : 502,
          `ELEVENLABS_PREVIEW_${response.status}`,
          `ElevenLabs returned HTTP ${response.status} for the Shared Voice preview.`,
          {
            retryable: classification.retryable,
            concurrencyLimited: classification.concurrencyLimited,
            retryAfterMs: retryAfterMs(response.headers.get("retry-after")),
            ...(requestId(response) ? { providerRequestId: requestId(response) } : {}),
          },
        );
      }
      const contentRangeHeader = response.headers.get("content-range");
      const contentRange = contentRangeHeader && /^bytes \d+-\d+\/(?:\d+|\*)$/.test(contentRangeHeader)
        ? contentRangeHeader
        : null;
      if (response.status === 206 && !contentRange) {
        throw new ProviderError(502, "ELEVENLABS_INVALID_AUDIO_RANGE", "ElevenLabs returned an invalid Shared Voice audio range.", {
          retryable: false,
        });
      }
      const audio = await readLimitedAudio(response);
      const startsAtBeginning = response.status === 200 || contentRange?.startsWith("bytes 0-") === true;
      const mimeType = previewMimeType(response.headers.get("content-type"), safeUrl, audio, startsAtBeginning);
      if (!mimeType) {
        throw new ProviderError(502, "ELEVENLABS_INVALID_AUDIO", "ElevenLabs did not return a valid Shared Voice audio preview.", {
          retryable: false,
          ...(requestId(response) ? { providerRequestId: requestId(response) } : {}),
        });
      }
      return {
        audio,
        mimeType,
        status: response.status,
        acceptRanges: response.headers.get("accept-ranges")?.toLowerCase() === "bytes" ? "bytes" : null,
        contentRange,
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      const message = error instanceof Error ? error.message : "Unknown network error";
      throw new ProviderError(503, "ELEVENLABS_NETWORK_ERROR", "Could not load the ElevenLabs Shared Voice preview.", {
        retryable: true,
        details: { cause: redactSecrets(message, [this.options.apiKey]) },
      });
    }
  }

  async getUsage(): Promise<ProviderUsage> {
    const subscription = await this.subscription();
    const used = subscription.character_count ?? null;
    const limit = subscription.character_limit ?? null;
    return {
      tier: subscription.tier ?? null,
      used,
      limit,
      remaining: used == null || limit == null ? null : Math.max(0, limit - used),
      resetsAt: subscription.next_character_count_reset_unix == null
        ? null
        : new Date(subscription.next_character_count_reset_unix * 1_000).toISOString(),
    };
  }

  async synthesize(input: SynthesizeInput): Promise<SynthesizeResult> {
    const params = new URLSearchParams({ output_format: input.outputFormat });
    const response = await this.request(
      `/v1/text-to-speech/${encodeURIComponent(input.voiceId)}?${params.toString()}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", accept: "audio/*" },
        body: JSON.stringify({
          text: input.text,
          model_id: input.modelId,
          ...(input.languageCode ? { language_code: input.languageCode } : {}),
          seed: input.seed,
          voice_settings: {
            stability: input.settings.stability,
            similarity_boost: input.settings.similarityBoost,
            style: input.settings.style,
            speed: input.settings.speed,
            use_speaker_boost: input.settings.useSpeakerBoost,
          },
        }),
      },
    );
    const contentType = response.headers.get("content-type")?.split(";", 1)[0] ?? "application/octet-stream";
    if (!contentType.startsWith("audio/") && contentType !== "application/octet-stream") {
      throw new ProviderError(502, "ELEVENLABS_INVALID_AUDIO", "ElevenLabs did not return audio data.", {
        retryable: false,
        ...(requestId(response) ? { providerRequestId: requestId(response) } : {}),
      });
    }
    const audio = new Uint8Array(await response.arrayBuffer());
    if (audio.byteLength === 0) {
      throw new ProviderError(502, "ELEVENLABS_EMPTY_AUDIO", "ElevenLabs returned an empty audio file.", {
        retryable: true,
        ...(requestId(response) ? { providerRequestId: requestId(response) } : {}),
      });
    }
    const characterCostHeader = response.headers.get("character-cost");
    const characterCost = characterCostHeader?.trim() ? Number(characterCostHeader) : Number.NaN;
    const normalizedMimeType = contentType === "application/octet-stream"
      ? input.outputFormat.startsWith("mp3")
        ? "audio/mpeg"
        : input.outputFormat.startsWith("pcm")
          ? "audio/pcm"
          : input.outputFormat.startsWith("ulaw")
            ? "audio/basic"
            : contentType
      : contentType;
    return {
      audio,
      mimeType: normalizedMimeType,
      extension: extensionFor(input.outputFormat, contentType),
      durationMs: null,
      providerRequestId: requestId(response) ?? null,
      actualUnits: Number.isFinite(characterCost) ? characterCost : input.text.length,
    };
  }
}
