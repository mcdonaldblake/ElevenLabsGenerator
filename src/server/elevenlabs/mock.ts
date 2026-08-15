import { ApiError } from "./errors";
import type {
  AccountVoiceList,
  AccountVoiceQuery,
  AudioStream,
  SharedVoice,
  SharedVoiceList,
  SharedVoiceQuery,
  SpeechInput,
  VoiceProvider,
} from "./types";

const mockSharedVoice: SharedVoice = {
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
  description: "Local test voice. No ElevenLabs credits are used.",
  previewUrl: "https://storage.googleapis.com/eleven-public-prod/mock/shared-preview.wav",
  verifiedLanguages: ["es"],
  featured: true,
  freeUsersAllowed: false,
  liveModerationEnabled: false,
  rate: null,
};

function createWave(text: string): Uint8Array {
  const sampleRate = 16_000;
  const durationMilliseconds = Math.min(1_500, Math.max(280, 200 + text.length * 12));
  const sampleCount = Math.floor(sampleRate * durationMilliseconds / 1_000);
  const audio = new Uint8Array(44 + sampleCount * 2);
  const view = new DataView(audio.buffer);
  const encoder = new TextEncoder();
  audio.set(encoder.encode("RIFF"), 0);
  view.setUint32(4, 36 + sampleCount * 2, true);
  audio.set(encoder.encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  audio.set(encoder.encode("data"), 36);
  view.setUint32(40, sampleCount * 2, true);
  let hash = 2_166_136_261;
  for (const byte of encoder.encode(text)) hash = Math.imul(hash ^ byte, 16_777_619) >>> 0;
  const frequency = 240 + hash % 220;
  for (let index = 0; index < sampleCount; index += 1) {
    const fade = Math.min(1, index / 300, (sampleCount - index) / 300);
    const sample = Math.sin(2 * Math.PI * frequency * index / sampleRate) * 0.08 * fade;
    view.setInt16(44 + index * 2, Math.round(sample * 32_767), true);
  }
  return audio;
}

function audioStream(audio: Uint8Array, requestId: string): AudioStream {
  return {
    stream: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(audio);
        controller.close();
      },
    }),
    mimeType: "audio/wav",
    status: 200,
    contentLength: audio.byteLength,
    acceptRanges: "bytes",
    contentRange: null,
    providerRequestId: requestId,
    characterCost: null,
  };
}

export class MockVoiceProvider implements VoiceProvider {
  readonly name = "mock" as const;

  async listAccountVoices(query: AccountVoiceQuery): Promise<AccountVoiceList> {
    const candidate = {
      id: "mock-mara",
      name: "Mara (mock)",
      description: "Local test voice. No ElevenLabs credits are used.",
      category: "mock",
      previewUrl: null,
      labels: { language: "es", locale: "es-MX", gender: "female" },
      source: "account" as const,
    };
    const search = query.search?.toLocaleLowerCase() ?? "";
    const voices = !search || `${candidate.name} ${candidate.description}`.toLocaleLowerCase().includes(search) ? [candidate] : [];
    return { voices, hasMore: false, nextPageToken: null, totalCount: voices.length };
  }

  async listSharedVoices(query: SharedVoiceQuery): Promise<SharedVoiceList> {
    const search = query.search?.toLocaleLowerCase() ?? "";
    const matches = (!search || `${mockSharedVoice.name} ${mockSharedVoice.description ?? ""}`.toLocaleLowerCase().includes(search))
      && (!query.language || query.language === mockSharedVoice.language)
      && (!query.accent || query.accent === mockSharedVoice.accent)
      && (!query.gender || query.gender === mockSharedVoice.gender)
      && (!query.age || query.age === mockSharedVoice.age)
      && (!query.category || query.category === mockSharedVoice.category)
      && (query.featured === undefined || query.featured === mockSharedVoice.featured)
      && (!query.useCases?.length || query.useCases.some((value) => mockSharedVoice.useCase.includes(value)));
    const all = matches ? [mockSharedVoice] : [];
    const start = query.page * query.pageSize;
    return {
      voices: all.slice(start, start + query.pageSize),
      page: query.page,
      pageSize: query.pageSize,
      hasMore: start + query.pageSize < all.length,
      totalCount: all.length,
    };
  }

  async addSharedVoice(_publicOwnerId: string, voiceId: string): Promise<{ voiceId: string }> {
    return { voiceId };
  }

  async previewSharedVoice(_previewUrl: string, range?: string): Promise<AudioStream> {
    if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) {
      throw new ApiError(416, "INVALID_RANGE", "The requested audio byte range is invalid.");
    }
    return audioStream(createWave("Shared Voice preview"), "mock-preview");
  }

  async synthesize(input: SpeechInput): Promise<AudioStream> {
    const result = audioStream(createWave(`${input.text}\n${input.voiceId}\n${input.seed ?? ""}`), "mock-speech");
    return { ...result, characterCost: input.text.length };
  }
}
