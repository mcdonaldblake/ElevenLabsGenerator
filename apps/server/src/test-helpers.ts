import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerConfig } from "./config.js";

export function testConfig(): { config: ServerConfig; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "voice-foundry-test-"));
  const data = join(root, "data");
  const projectRoot = fileURLToPath(new URL("../../..", import.meta.url));
  mkdirSync(data, { recursive: true });
  return {
    config: {
      nodeEnv: "test",
      host: "127.0.0.1",
      port: 4317,
      projectRoot,
      databasePath: join(data, "test.sqlite"),
      audioRoot: join(data, "audio"),
      exportRoot: join(data, "exports"),
      migrationsRoot: resolve(projectRoot, "drizzle"),
      elevenLabsApiKey: "",
      elevenLabsApiBaseUrl: "https://api.elevenlabs.io",
      ttsProvider: "mock",
      concurrency: 2,
      outputFormat: "mp3_44100_128",
      maxClipsPerBatch: 2_000,
      maxCharactersPerBatch: 250_000,
      maxImportBytes: 25_000_000,
      maxImportRows: 100_000,
      queueMaxAttempts: 4,
      queueMaxConsecutiveFailures: 10,
      lanAccessEnabled: false,
      openBrowser: false,
      logLevel: "silent",
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
