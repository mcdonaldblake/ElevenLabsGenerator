import type {
  AccountVoice,
  DashboardData,
  ExportPreview,
  ExportRecord,
  Phrase,
  PhrasePage,
  ProductionMode,
  ProductionPreflight,
  Project,
  ReviewPage,
  TtsBatch,
  UsageSummary,
  VoiceProfile,
} from "../types";

const recent = new Date(Date.now() - 1000 * 60 * 42).toISOString();
const yesterday = new Date(Date.now() - 1000 * 60 * 60 * 21).toISOString();

export const mockProjects: Project[] = [
  {
    id: "project_demo",
    name: "Mara · Core transitions",
    code: "mara-core-transitions",
    createdAt: "2026-08-01T15:00:00.000Z",
    updatedAt: recent,
  },
];

const samplePhrases = [
  ["Eso es. Seguimos.", "correct_continue", "warm"],
  ["Muy bien, vamos con la siguiente.", "correct_continue", "warm"],
  ["Perfecto. Adelante.", "correct_continue", "casual"],
  ["Así es. Continuemos.", "correct_continue", "calm"],
  ["Bien hecho, seguimos.", "correct_continue", "encouraging"],
  ["Exacto. Vamos a la siguiente.", "correct_continue", "neutral"],
  ["Muy bien. Una más.", "correct_continue", "warm"],
  ["Eso estuvo bien. Continuemos.", "correct_continue", "encouraging"],
  ["Correcto. Seguimos adelante.", "correct_continue", "neutral"],
  ["Excelente. Vamos con otra.", "correct_continue", "celebratory"],
  ["Listo. Seguimos.", "correct_continue", "casual"],
  ["Bien. Ahora la siguiente.", "correct_continue", "calm"],
] as const;

export const mockPhrases: Phrase[] = Array.from({ length: 72 }, (_, index) => {
  const sample = samplePhrases[index % samplePhrases.length] ?? samplePhrases[0];
  const displayText = index >= samplePhrases.length ? `${sample[0].replace(/[.]$/, "")} ${index + 1}.` : sample[0];
  const phraseDecision = index < 46 ? "kept" : index < 54 ? "discarded" : "pending";
  const ready = phraseDecision === "kept" && index < 35;
  return {
    id: `phrase_demo_${String(index + 1).padStart(3, "0")}`,
    projectId: "project_demo",
    externalId: `correct-continue-${String(index + 1).padStart(3, "0")}`,
    displayText,
    synthesisText: null,
    groupCode: sample[1],
    category: sample[2],
    tone: sample[2],
    englishMeaning: "",
    notes: index === 3 ? "Keep the delivery unhurried." : "",
    decision: phraseDecision,
    audioStatus: ready ? "ready" : index === 35 ? "queued" : "none",
    sourceFile: index < 50 ? "august-core-phrases.csv" : "short-variations.txt",
    sourceRow: index + 2,
    wordCount: displayText.split(/\s+/).length,
    characterCount: displayText.length,
    takeCount: ready ? (index % 5 === 0 ? 2 : 1) : 0,
    primaryTakeId: ready && index < 20 ? `take_demo_${index + 1}_1` : null,
    updatedAt: recent,
  };
});

export function mockPhrasePage(options: {
  page: number;
  pageSize: number;
  search: string;
  decision: string;
  audioStatus: string;
}): PhrasePage {
  const search = options.search.trim().toLocaleLowerCase("es-MX");
  const filtered = mockPhrases.filter((phrase) => {
    const matchesSearch = !search || [phrase.displayText, phrase.externalId, phrase.groupCode, phrase.category]
      .some((value) => value.toLocaleLowerCase("es-MX").includes(search));
    return matchesSearch
      && (!options.decision || options.decision === "all" || phrase.decision === options.decision)
      && (!options.audioStatus || options.audioStatus === "all" || phrase.audioStatus === options.audioStatus);
  });
  const start = (options.page - 1) * options.pageSize;
  return {
    items: filtered.slice(start, start + options.pageSize),
    page: options.page,
    pageSize: options.pageSize,
    total: filtered.length,
  };
}

export const mockVoiceProfiles: VoiceProfile[] = [
  {
    id: "profile_mara_v2",
    projectId: "project_demo",
    label: "Mara · Warm conversational",
    version: 2,
    voiceId: "demo-voice-mara",
    voiceName: "Mara demo voice",
    modelId: "eleven_multilingual_v2",
    languageCode: "es",
    outputFormat: "mp3_44100_128",
    settings: {
      stability: 0.58,
      similarityBoost: 0.78,
      style: 0.12,
      speed: 0.96,
      useSpeakerBoost: true,
    },
    notes: "Calm, warm delivery for short Mexican Spanish transitions.",
    lockedAt: "2026-08-10T18:30:00.000Z",
    isProduction: true,
    createdAt: "2026-08-10T18:20:00.000Z",
  },
  {
    id: "profile_mara_v1",
    projectId: "project_demo",
    label: "Mara · Initial recipe",
    version: 1,
    voiceId: "demo-voice-mara",
    voiceName: "Mara demo voice",
    modelId: "eleven_multilingual_v2",
    languageCode: "es",
    outputFormat: "mp3_44100_128",
    settings: {
      stability: 0.5,
      similarityBoost: 0.75,
      style: 0.08,
      speed: 1,
      useSpeakerBoost: true,
    },
    notes: "First calibration recipe.",
    lockedAt: "2026-08-04T16:00:00.000Z",
    isProduction: false,
    createdAt: "2026-08-04T15:40:00.000Z",
  },
];

export const mockAccountVoices: AccountVoice[] = [
  {
    id: "demo-voice-mara",
    name: "Mara demo voice",
    category: "Personal",
    description: "Warm, clear Spanish voice used by the demo workspace.",
    labels: { language: "Spanish", accent: "Mexican" },
    previewUrl: null,
  },
  {
    id: "demo-voice-elena",
    name: "Elena",
    category: "Account voice",
    description: "Measured adult voice with a clear conversational pace.",
    labels: { language: "Spanish" },
    previewUrl: null,
  },
];

export const mockActiveBatch: TtsBatch = {
  id: "batch_demo_0813",
  projectId: "project_demo",
  mode: "first_pass",
  status: "running",
  totalJobs: 46,
  completedJobs: 31,
  failedJobs: 1,
  queuedJobs: 12,
  runningJobs: 2,
  activeRequests: 2,
  characters: 1_284,
  createdAt: recent,
  updatedAt: new Date().toISOString(),
  lastError: null,
};

export const mockDashboard: DashboardData = {
  imported: 72,
  kept: 46,
  discarded: 8,
  pending: 18,
  audioReady: 35,
  exportReady: 20,
  activeBatch: mockActiveBatch,
  recentImports: [
    { id: "import_demo_2", fileName: "short-variations.txt", importedCount: 22, createdAt: recent },
    { id: "import_demo_1", fileName: "august-core-phrases.csv", importedCount: 50, createdAt: yesterday },
  ],
};

export function mockPreflight(mode: ProductionMode): ProductionPreflight {
  const calibration = mode === "calibration";
  return {
    mode,
    eligiblePhrases: calibration ? 10 : 11,
    skippedPhrases: calibration ? 36 : 35,
    totalRequests: calibration ? 10 : 11,
    totalCharacters: calibration ? 286 : 342,
    cachedRequests: calibration ? 2 : 0,
    estimatedCredits: calibration ? 286 : 342,
    warnings: calibration ? [] : ["One phrase already has a queued take and will be skipped."],
    canStart: true,
  };
}

export const mockReview: ReviewPage = {
  items: mockPhrases.slice(20, 35).map((phrase, phraseIndex) => ({
    phrase: { ...phrase, decision: "pending", primaryTakeId: null },
    takes: Array.from({ length: phraseIndex % 4 === 0 ? 2 : 1 }, (_, takeIndex) => ({
      id: `take_demo_${phraseIndex + 21}_${takeIndex + 1}`,
      phraseId: phrase.id,
      takeNumber: takeIndex + 1,
      durationMs: 1_100 + phraseIndex * 90 + takeIndex * 130,
      seed: 10_000 + phraseIndex * 10 + takeIndex,
      decision: "pending",
      isPrimary: false,
      voiceProfileVersion: 2,
      settingsLabel: takeIndex === 0 ? "Production recipe" : "Regeneration · stability 0.52",
      createdAt: recent,
    })),
  })),
  page: 1,
  pageSize: 200,
  total: 15,
  counts: { pending: 15, kept: 20, discarded: 2 },
};

export const mockExportPreview: ExportPreview = {
  eligibleAssets: 20,
  excludedPhrases: 26,
  totalDurationMs: 42_860,
  totalBytes: 1_428_300,
  errors: [],
  warnings: ["15 kept phrases still need a primary audio take."],
  canExport: true,
  sampleFiles: [
    "audio/mara/correct-continue/mara-correct-continue-001.mp3",
    "audio/mara/correct-continue/mara-correct-continue-002.mp3",
    "audio/mara/correct-continue/mara-correct-continue-003.mp3",
    "manifest.json",
    "audio-map.ts",
    "phrases.csv",
    "voice-profile.json",
  ],
};

export const mockExports: ExportRecord[] = [
  {
    id: "export_demo_0812",
    label: "Mara core transitions · review cut",
    status: "ready",
    itemCount: 18,
    totalBytes: 1_284_400,
    path: "data/exports/mara-core-2026-08-12.zip",
    createdAt: yesterday,
  },
];

export const mockUsage: UsageSummary = {
  provider: "ElevenLabs",
  usedCharacters: 18_420,
  includedCharacters: 100_000,
  remainingCharacters: 81_580,
  periodEndsAt: "2026-09-01T00:00:00.000Z",
  totalRequests: 618,
};
