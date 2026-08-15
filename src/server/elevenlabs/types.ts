export type VoiceSettings = {
  stability: number;
  similarityBoost: number;
  style: number;
  speed: number;
  useSpeakerBoost: boolean;
};

export type AccountVoiceQuery = {
  search?: string | undefined;
  pageSize: number;
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

export type AccountVoiceList = {
  voices: AccountVoice[];
  hasMore: boolean;
  nextPageToken: string | null;
  totalCount: number | null;
};

export type SharedVoiceSort = "created_date" | "usage_character_count_1y" | "trending" | "cloned_by_count";

export type SharedVoiceQuery = {
  search?: string | undefined;
  page: number;
  pageSize: number;
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

export type SharedVoiceList = {
  voices: SharedVoice[];
  page: number;
  pageSize: number;
  hasMore: boolean;
  totalCount: number;
};

export type SpeechInput = {
  text: string;
  voiceId: string;
  modelId: "eleven_multilingual_v2" | "eleven_v3" | "eleven_flash_v2_5";
  languageCode?: string | null | undefined;
  outputFormat: "mp3_44100_128" | "mp3_44100_192";
  seed?: number | undefined;
  settings: VoiceSettings;
};

export type AudioStream = {
  stream: ReadableStream<Uint8Array>;
  mimeType: string;
  status: 200 | 206;
  contentLength: number | null;
  acceptRanges: "bytes" | null;
  contentRange: string | null;
  providerRequestId: string | null;
  characterCost: number | null;
};

export interface VoiceProvider {
  readonly name: "elevenlabs" | "mock";
  listAccountVoices(query: AccountVoiceQuery): Promise<AccountVoiceList>;
  listSharedVoices(query: SharedVoiceQuery): Promise<SharedVoiceList>;
  addSharedVoice(
    publicOwnerId: string,
    voiceId: string,
    input: { newName: string; bookmarked?: boolean | undefined },
  ): Promise<{ voiceId: string }>;
  previewSharedVoice(previewUrl: string, range?: string | undefined): Promise<AudioStream>;
  synthesize(input: SpeechInput): Promise<AudioStream>;
}
