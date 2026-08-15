import { fileURLToPath } from "node:url";
import { isAbsolute, resolve } from "node:path";
import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

const projectRoot = fileURLToPath(new URL("../../..", import.meta.url));
loadDotEnv({ path: resolve(projectRoot, ".env"), quiet: true });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOCAL_SERVER_PORT: z.coerce.number().int().min(1024).max(65535).default(4317),
  DATABASE_PATH: z.string().min(1).default("./data/voice-foundry.sqlite"),
  AUDIO_ROOT: z.string().min(1).default("./data/generated-audio"),
  EXPORT_ROOT: z.string().min(1).default("./data/exports"),
  ELEVENLABS_API_KEY: z.string().default(""),
  ELEVENLABS_API_BASE_URL: z.string().url().default("https://api.elevenlabs.io"),
  TTS_PROVIDER: z.enum(["mock", "elevenlabs"]).default("mock"),
  ELEVENLABS_DEFAULT_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
  ELEVENLABS_OUTPUT_FORMAT: z.string().min(1).default("mp3_44100_128"),
  MAX_CLIPS_PER_BATCH: z.coerce.number().int().min(1).max(100_000).default(2_000),
  MAX_CHARACTERS_PER_BATCH: z.coerce.number().int().min(1).max(10_000_000).default(250_000),
  MAX_IMPORT_BYTES: z.coerce.number().int().min(1_024).max(500_000_000).default(25_000_000),
  MAX_IMPORT_ROWS: z.coerce.number().int().min(1).max(1_000_000).default(100_000),
  QUEUE_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(4),
  QUEUE_MAX_CONSECUTIVE_FAILURES: z.coerce.number().int().min(1).max(1_000).default(10),
  LAN_ACCESS_ENABLED: z.string().default("false").transform((value) => value.toLowerCase() === "true"),
  OPEN_BROWSER: z.string().default("false").transform((value) => value.toLowerCase() === "true"),
  LOG_LEVEL: z.string().default("info"),
});

export type ServerConfig = {
  nodeEnv: "development" | "test" | "production";
  host: "127.0.0.1" | "0.0.0.0";
  port: number;
  projectRoot: string;
  databasePath: string;
  audioRoot: string;
  exportRoot: string;
  migrationsRoot: string;
  elevenLabsApiKey: string;
  elevenLabsApiBaseUrl: string;
  ttsProvider: "mock" | "elevenlabs";
  concurrency: number;
  outputFormat: string;
  maxClipsPerBatch: number;
  maxCharactersPerBatch: number;
  maxImportBytes: number;
  maxImportRows: number;
  queueMaxAttempts: number;
  queueMaxConsecutiveFailures: number;
  lanAccessEnabled: boolean;
  openBrowser: boolean;
  logLevel: string;
};

function resolveLocalPath(root: string, value: string): string {
  return isAbsolute(value) ? value : resolve(root, value);
}

export function readConfig(
  overrides: Partial<ServerConfig> = {},
  source: NodeJS.ProcessEnv = process.env,
): ServerConfig {
  const parsed = envSchema.parse(source);
  const root = overrides.projectRoot ?? projectRoot;
  const lanAccessEnabled = overrides.lanAccessEnabled ?? parsed.LAN_ACCESS_ENABLED;
  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.LOCAL_SERVER_PORT,
    projectRoot: root,
    databasePath: resolveLocalPath(root, parsed.DATABASE_PATH),
    audioRoot: resolveLocalPath(root, parsed.AUDIO_ROOT),
    exportRoot: resolveLocalPath(root, parsed.EXPORT_ROOT),
    migrationsRoot: resolve(root, "drizzle"),
    elevenLabsApiKey: parsed.ELEVENLABS_API_KEY,
    elevenLabsApiBaseUrl: parsed.ELEVENLABS_API_BASE_URL.replace(/\/$/, ""),
    ttsProvider: parsed.TTS_PROVIDER,
    concurrency: parsed.ELEVENLABS_DEFAULT_CONCURRENCY,
    outputFormat: parsed.ELEVENLABS_OUTPUT_FORMAT,
    maxClipsPerBatch: parsed.MAX_CLIPS_PER_BATCH,
    maxCharactersPerBatch: parsed.MAX_CHARACTERS_PER_BATCH,
    maxImportBytes: parsed.MAX_IMPORT_BYTES,
    maxImportRows: parsed.MAX_IMPORT_ROWS,
    queueMaxAttempts: parsed.QUEUE_MAX_ATTEMPTS,
    queueMaxConsecutiveFailures: parsed.QUEUE_MAX_CONSECUTIVE_FAILURES,
    openBrowser: parsed.OPEN_BROWSER,
    logLevel: parsed.LOG_LEVEL,
    ...overrides,
    lanAccessEnabled,
    host: lanAccessEnabled ? "0.0.0.0" : "127.0.0.1",
  };
}

export function maskedSecret(value: string): string | null {
  if (!value) return null;
  return `••••••${value.slice(-4)}`;
}
