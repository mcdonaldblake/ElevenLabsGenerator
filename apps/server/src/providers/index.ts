import type { ServerConfig } from "../config.js";
import { ElevenLabsTtsProvider } from "./elevenlabs.js";
import { MockTtsProvider } from "./mock.js";
import type { TtsProvider } from "./types.js";

export function createTtsProvider(config: ServerConfig): TtsProvider {
  if (config.ttsProvider === "elevenlabs") {
    return new ElevenLabsTtsProvider({
      apiKey: config.elevenLabsApiKey,
      baseUrl: config.elevenLabsApiBaseUrl,
    });
  }
  return new MockTtsProvider();
}

export * from "./types.js";
export { ElevenLabsTtsProvider } from "./elevenlabs.js";
