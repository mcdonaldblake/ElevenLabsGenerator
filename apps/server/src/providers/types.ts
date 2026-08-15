import type { VoiceSettings } from "@voice-foundry/domain";
import { AppError } from "../errors.js";

export type VoiceListQuery = {
  search?: string | undefined;
  pageSize?: number;
  nextPageToken?: string | undefined;
  voiceType?: string | undefined;
  category?: string | undefined;
};

export type AccountVoice = {
  id: string;
  name: string;
  description: string;
  category: string;
  previewUrl: string | null;
  labels: Record<string, string>;
  source: "account";
};

export type VoiceListResult = {
  voices: AccountVoice[];
  hasMore: boolean;
  nextPageToken: string | null;
  totalCount: number | null;
};

export type SharedVoiceSort = "created_date" | "usage_character_count_1y" | "trending" | "cloned_by_count";

export type SharedVoiceQuery = {
  search?: string | undefined;
  page?: number;
  pageSize?: number;
  category?: "professional" | "famous" | "high_quality" | undefined;
  gender?: string | undefined;
  age?: string | undefined;
  accent?: string | undefined;
  language?: string | undefined;
  locale?: string | undefined;
  useCases?: string[] | undefined;
  descriptives?: string[] | undefined;
  featured?: boolean | undefined;
  minNoticePeriodDays?: number | undefined;
  includeCustomRates?: boolean | undefined;
  includeLiveModerated?: boolean | undefined;
  readerAppEnabled?: boolean | undefined;
  ownerId?: string | undefined;
  sort?: SharedVoiceSort | undefined;
};

export type SharedVoice = {
  publicOwnerId: string;
  voiceId: string;
  name: string;
  accent: string;
  gender: string;
  age: string;
  descriptive: string[];
  useCase: string[];
  category: string;
  language: string;
  locale: string | null;
  description: string | null;
  previewUrl: string | null;
  verifiedLanguages: string[];
  featured: boolean;
  freeUsersAllowed: boolean;
  liveModerationEnabled: boolean;
  rate: number | null;
};

export type SharedVoiceListResult = {
  voices: SharedVoice[];
  page: number;
  pageSize: number;
  hasMore: boolean;
  totalCount: number;
};

export type SharedVoicePreview = {
  audio: Uint8Array;
  mimeType: string;
  status: 200 | 206;
  acceptRanges: "bytes" | null;
  contentRange: string | null;
};

export type ProviderUsage = {
  tier: string | null;
  used: number | null;
  limit: number | null;
  remaining: number | null;
  resetsAt: string | null;
};

export type SynthesizeInput = {
  text: string;
  voiceId: string;
  modelId: string;
  outputFormat: string;
  languageCode: string | null;
  settings: VoiceSettings;
  seed: number;
};

export type SynthesizeResult = {
  audio: Uint8Array;
  mimeType: string;
  extension: string;
  durationMs: number | null;
  providerRequestId: string | null;
  actualUnits: number | null;
};

export interface TtsProvider {
  readonly name: "mock" | "elevenlabs";
  testConnection(): Promise<{ ok: true; account: { tier: string | null } }>;
  listAccountVoices(query: VoiceListQuery): Promise<VoiceListResult>;
  listSharedVoices(query: SharedVoiceQuery): Promise<SharedVoiceListResult>;
  addSharedVoice(publicOwnerId: string, voiceId: string, input: { newName: string; bookmarked?: boolean }): Promise<{ voiceId: string }>;
  fetchSharedVoicePreview(previewUrl: string, range?: string): Promise<SharedVoicePreview>;
  getUsage(): Promise<ProviderUsage>;
  synthesize(input: SynthesizeInput): Promise<SynthesizeResult>;
}

export class ProviderError extends AppError {
  readonly retryAfterMs: number | null;
  readonly concurrencyLimited: boolean;

  constructor(statusCode: number, code: string, message: string, options: {
    retryable: boolean;
    providerRequestId?: string | undefined;
    retryAfterMs?: number | null;
    concurrencyLimited?: boolean;
    details?: Record<string, unknown>;
  }) {
    super(statusCode, code, message, {
      retryable: options.retryable,
      provider: "elevenlabs",
      ...(options.providerRequestId ? { providerRequestId: options.providerRequestId } : {}),
      ...(options.details ? { details: options.details } : {}),
    });
    this.name = "ProviderError";
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.concurrencyLimited = options.concurrencyLimited ?? false;
  }
}
