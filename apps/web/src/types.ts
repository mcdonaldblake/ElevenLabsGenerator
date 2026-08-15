export type AppPage =
  | "overview"
  | "import"
  | "phrases"
  | "voice"
  | "production"
  | "review"
  | "exports"
  | "settings";

export type PhraseDecision = "pending" | "kept" | "discarded";
export type AudioStatus = "none" | "queued" | "ready" | "failed";

export type Project = {
  id: string;
  name: string;
  code: string;
  createdAt: string;
  updatedAt: string;
};

export type Phrase = {
  id: string;
  projectId: string;
  externalId: string;
  displayText: string;
  synthesisText: string | null;
  groupCode: string;
  category: string;
  tone: string;
  englishMeaning: string;
  notes: string;
  decision: PhraseDecision;
  audioStatus: AudioStatus;
  sourceFile: string;
  sourceRow: number;
  wordCount: number;
  characterCount: number;
  takeCount: number;
  primaryTakeId: string | null;
  updatedAt: string;
};

export type PhrasePage = {
  items: Phrase[];
  page: number;
  pageSize: number;
  total: number;
};

export type ImportPreviewRow = {
  sourceRow: number;
  externalId: string;
  displayText: string;
  synthesisText: string | null;
  groupCode: string;
  category: string;
  tone: string;
  englishMeaning: string;
  notes: string;
  status: "valid" | "duplicate" | "invalid";
  issue: string | null;
};

export type ImportPreview = {
  fileName: string;
  fileType: string;
  totalRows: number;
  validRows: number;
  duplicateRows: number;
  invalidRows: number;
  detectedFields: string[];
  warnings: string[];
  rows: ImportPreviewRow[];
};

export type ImportResult = {
  id: string;
  importedCount: number;
  duplicateCount: number;
  invalidCount: number;
  status: string;
};

export type VoiceSettings = {
  stability: number;
  similarityBoost: number;
  style: number;
  speed: number;
  useSpeakerBoost: boolean;
};

export type AccountVoice = {
  id: string;
  name: string;
  category: string;
  description: string;
  labels: Record<string, string>;
  previewUrl: string | null;
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

export type VoiceProfile = {
  id: string;
  projectId: string;
  label: string;
  version: number;
  voiceId: string;
  voiceName: string;
  modelId: string;
  languageCode: string | null;
  outputFormat: string;
  settings: VoiceSettings;
  notes: string;
  lockedAt: string | null;
  isProduction: boolean;
  createdAt: string;
};

export type VoiceProfileDraft = {
  projectId: string;
  label: string;
  voiceId: string;
  voiceName: string;
  modelId: string;
  languageCode: string | null;
  outputFormat: string;
  settings: VoiceSettings;
  notes: string;
};

export type DashboardData = {
  imported: number;
  kept: number;
  discarded: number;
  pending: number;
  audioReady: number;
  exportReady: number;
  activeBatch: TtsBatch | null;
  recentImports: Array<{
    id: string;
    fileName: string;
    importedCount: number;
    createdAt: string;
  }>;
};

export type ProductionMode = "calibration" | "first_pass" | "regeneration";

export type ProductionPreflight = {
  mode: ProductionMode;
  eligiblePhrases: number;
  skippedPhrases: number;
  totalRequests: number;
  totalCharacters: number;
  cachedRequests: number;
  estimatedCredits: number | null;
  warnings: string[];
  canStart: boolean;
};

export type TtsBatch = {
  id: string;
  projectId: string;
  mode: ProductionMode;
  status:
    | "draft"
    | "queued"
    | "running"
    | "retry_wait"
    | "succeeded"
    | "failed"
    | "partial"
    | "canceled";
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  queuedJobs: number;
  runningJobs: number;
  activeRequests: number;
  characters: number;
  createdAt: string;
  updatedAt: string;
  lastError: string | null;
};

export type AudioTake = {
  id: string;
  phraseId: string;
  takeNumber: number;
  durationMs: number | null;
  seed: number | null;
  decision: PhraseDecision;
  isPrimary: boolean;
  voiceProfileVersion: number;
  settingsLabel: string;
  createdAt: string;
};

export type ReviewItem = {
  phrase: Phrase;
  takes: AudioTake[];
};

export type ReviewPage = {
  items: ReviewItem[];
  page: number;
  pageSize: number;
  total: number;
  counts: {
    pending: number;
    kept: number;
    discarded: number;
  };
};

export type ExportPreview = {
  eligibleAssets: number;
  excludedPhrases: number;
  totalDurationMs: number;
  totalBytes: number;
  errors: string[];
  warnings: string[];
  canExport: boolean;
  sampleFiles: string[];
};

export type ExportRecord = {
  id: string;
  label: string;
  status: "creating" | "ready" | "failed";
  itemCount: number;
  totalBytes: number;
  path: string;
  createdAt: string;
};

export type UsageSummary = {
  provider: string;
  usedCharacters: number;
  includedCharacters: number | null;
  remainingCharacters: number | null;
  periodEndsAt: string | null;
  totalRequests: number;
};

export type HealthStatus = {
  ok: boolean;
  server: "online" | "offline";
  database: "ready" | "unavailable";
  providerMode: "live" | "mock" | "unconfigured";
  version: string;
};

export type ToastMessage = {
  id: number;
  tone: "success" | "error" | "info";
  title: string;
  detail: string;
};
