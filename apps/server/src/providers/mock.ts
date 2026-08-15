import { createHash } from "node:crypto";
import type {
  AccountVoice,
  ProviderUsage,
  SharedVoice,
  SharedVoiceListResult,
  SharedVoicePreview,
  SharedVoiceQuery,
  SynthesizeInput,
  SynthesizeResult,
  TtsProvider,
  VoiceListQuery,
  VoiceListResult,
} from "./types.js";

const voices: AccountVoice[] = [
  {
    id: "mock-mara",
    name: "Mara (mock)",
    description: "Local synthetic test tone. No provider credits are used.",
    category: "mock",
    previewUrl: null,
    labels: { language: "es", locale: "es-MX", gender: "female" },
    source: "account",
  },
];

const sharedVoices: SharedVoice[] = [
  {
    publicOwnerId: "mock-owner",
    voiceId: "mock-shared-mara",
    name: "Mara Shared (mock)",
    accent: "mexican",
    gender: "female",
    age: "young",
    descriptive: ["warm", "clear"],
    useCase: ["conversational"],
    category: "professional",
    language: "es",
    locale: "es-MX",
    description: "Local Shared Voice Library fixture. No provider request is made.",
    previewUrl: "https://storage.googleapis.com/eleven-public-prod/mock/shared-preview.mp3",
    verifiedLanguages: ["es"],
    featured: false,
    freeUsersAllowed: false,
    liveModerationEnabled: false,
    rate: null,
  },
];

function createWave(text: string): { audio: Uint8Array; durationMs: number } {
  const sampleRate = 16_000;
  const durationMs = Math.min(1_600, Math.max(250, 180 + text.length * 18));
  const sampleCount = Math.floor(sampleRate * durationMs / 1_000);
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  const seed = createHash("sha256").update(text).digest().readUInt16LE(0);
  const frequency = 260 + seed % 180;

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const fade = Math.min(1, index / 300, (sampleCount - index) / 300);
    const sample = Math.sin(2 * Math.PI * frequency * index / sampleRate) * 0.08 * fade;
    buffer.writeInt16LE(Math.round(sample * 32_767), 44 + index * 2);
  }
  return { audio: buffer, durationMs };
}

export class MockTtsProvider implements TtsProvider {
  readonly name = "mock" as const;

  async testConnection(): Promise<{ ok: true; account: { tier: string | null } }> {
    return { ok: true, account: { tier: "mock" } };
  }

  async listAccountVoices(query: VoiceListQuery): Promise<VoiceListResult> {
    const search = query.search?.toLocaleLowerCase() ?? "";
    const filtered = voices.filter((voice) => !search || `${voice.name} ${voice.description}`.toLocaleLowerCase().includes(search));
    return { voices: filtered, hasMore: false, nextPageToken: null, totalCount: filtered.length };
  }

  async listSharedVoices(query: SharedVoiceQuery): Promise<SharedVoiceListResult> {
    const search = query.search?.toLocaleLowerCase() ?? "";
    const filtered = sharedVoices.filter((voice) => {
      if (search && !`${voice.name} ${voice.description ?? ""}`.toLocaleLowerCase().includes(search)) return false;
      if (query.language && voice.language !== query.language) return false;
      if (query.accent && voice.accent !== query.accent) return false;
      if (query.gender && voice.gender !== query.gender) return false;
      if (query.age && voice.age !== query.age) return false;
      if (query.category && voice.category !== query.category) return false;
      if (query.featured !== undefined && voice.featured !== query.featured) return false;
      if (query.useCases?.length && !query.useCases.some((value) => voice.useCase.includes(value))) return false;
      return true;
    });
    const page = Math.max(0, query.page ?? 0);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 24));
    const start = page * pageSize;
    return {
      voices: filtered.slice(start, start + pageSize),
      page,
      pageSize,
      hasMore: start + pageSize < filtered.length,
      totalCount: filtered.length,
    };
  }

  async addSharedVoice(_publicOwnerId: string, voiceId: string, _input: { newName: string; bookmarked?: boolean }): Promise<{ voiceId: string }> {
    return { voiceId };
  }

  async fetchSharedVoicePreview(_previewUrl: string, _range?: string): Promise<SharedVoicePreview> {
    const generated = createWave("Shared Voice preview fixture");
    return {
      audio: generated.audio,
      mimeType: "audio/wav",
      status: 200,
      acceptRanges: "bytes",
      contentRange: null,
    };
  }

  async getUsage(): Promise<ProviderUsage> {
    return { tier: "mock", used: 0, limit: null, remaining: null, resetsAt: null };
  }

  async synthesize(input: SynthesizeInput): Promise<SynthesizeResult> {
    const generated = createWave(`${input.text}\n${input.seed}\n${input.voiceId}`);
    return {
      audio: generated.audio,
      mimeType: "audio/wav",
      extension: "wav",
      durationMs: generated.durationMs,
      providerRequestId: `mock-${createHash("sha256").update(input.text).digest("hex").slice(0, 16)}`,
      actualUnits: input.text.length,
    };
  }
}
