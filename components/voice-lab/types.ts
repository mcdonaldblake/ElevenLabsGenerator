export type VoiceSettings = {
  stability: number;
  similarityBoost: number;
  style: number;
  speed: number;
  useSpeakerBoost: boolean;
};

export type VoiceRecipe = {
  voiceId: string;
  voiceName: string;
  modelId: "eleven_multilingual_v2" | "eleven_v3" | "eleven_flash_v2_5";
  languageCode: string;
  outputFormat: "mp3_44100_128" | "mp3_44100_192";
  seed: number | null;
  settings: VoiceSettings;
};

export const DEFAULT_RECIPE: VoiceRecipe = {
  voiceId: "",
  voiceName: "",
  modelId: "eleven_multilingual_v2",
  languageCode: "",
  outputFormat: "mp3_44100_128",
  seed: null,
  settings: {
    stability: 0.5,
    similarityBoost: 0.75,
    style: 0,
    speed: 1,
    useSpeakerBoost: true,
  },
};

export type AccountVoice = {
  id: string;
  name: string;
  description: string;
  category: string;
  previewUrl: string | null;
  labels: Record<string, string>;
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
  description: string;
  previewUrl: string | null;
  verifiedLanguages: string[];
  featured: boolean;
  freeUsersAllowed: boolean;
  liveModerationEnabled: boolean;
  rate: number | null;
};

export type SharedVoicePage = {
  voices: SharedVoice[];
  page: number;
  pageSize: number;
  hasMore: boolean;
  totalCount: number | null;
};

export type ImportStatus = "valid" | "duplicate" | "invalid";

export type ImportCandidate = {
  sourceRow: number;
  id: string;
  filename: string;
  text: string;
  status: ImportStatus;
  issue: string | null;
};

export type ImportPreview = {
  fileName: string;
  fileType: string;
  totalRows: number;
  validRows: number;
  duplicateRows: number;
  invalidRows: number;
  rows: ImportCandidate[];
};

export type PhraseStatus = "pending" | "generating" | "ready" | "failed";

export type PhraseJob = {
  key: string;
  sequence: number;
  id: string;
  filename: string;
  text: string;
  status: PhraseStatus;
  error: string | null;
  audio: Blob | null;
  audioUrl: string | null;
  recipeFingerprint: string | null;
  recipeSnapshot: VoiceRecipe | null;
};

export type Notice = {
  tone: "success" | "error" | "info";
  message: string;
};
