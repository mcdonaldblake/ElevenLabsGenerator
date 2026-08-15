import { ApiError } from "./errors";
import { ElevenLabsClient } from "./client";
import { MockVoiceProvider } from "./mock";
import type { VoiceProvider } from "./types";

let cachedProvider: VoiceProvider | undefined;

export function createVoiceProvider(environment: NodeJS.ProcessEnv = process.env): VoiceProvider {
  const mode = environment.ELEVENLABS_PROVIDER?.trim() || "elevenlabs";
  if (mode === "mock") {
    if (environment.NODE_ENV === "production") {
      throw new ApiError(500, "UNSAFE_MOCK_CONFIGURATION", "Mock mode cannot run in a production build.");
    }
    return new MockVoiceProvider();
  }
  if (mode !== "elevenlabs") {
    throw new ApiError(500, "INVALID_PROVIDER_CONFIGURATION", "ELEVENLABS_PROVIDER must be elevenlabs or mock.");
  }
  return new ElevenLabsClient({ apiKey: environment.ELEVENLABS_API_KEY?.trim() ?? "" });
}

export function getVoiceProvider(): VoiceProvider {
  cachedProvider ??= createVoiceProvider();
  return cachedProvider;
}
