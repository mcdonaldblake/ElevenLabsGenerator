import { z } from "zod";

export const voiceSettingsSchema = z.object({
  stability: z.number().min(0).max(1).default(0.5),
  similarityBoost: z.number().min(0).max(1).default(0.75),
  style: z.number().min(0).max(1).default(0),
  speed: z.number().min(0.7).max(1.2).default(1),
  useSpeakerBoost: z.boolean().default(true),
});

export const voiceProfileInputSchema = z.object({
  projectId: z.string().min(1),
  label: z.string().trim().min(1).max(100),
  voiceId: z.string().trim().min(1).max(100),
  voiceName: z.string().trim().max(100).default(""),
  modelId: z.string().trim().min(1).max(100),
  languageCode: z.string().trim().min(2).max(10).nullable().default("es"),
  outputFormat: z.string().trim().min(1).max(60),
  settings: voiceSettingsSchema,
});

export const createTtsBatchSchema = z.object({
  projectId: z.string().min(1),
  voiceProfileVersionId: z.string().min(1),
  phraseIds: z.array(z.string().min(1)).max(10_000).optional(),
  mode: z.enum(["calibration", "first_pass", "regeneration"]).default("first_pass"),
  confirmed: z.literal(true),
});

export const phrasePatchSchema = z.object({
  displayText: z.string().trim().min(1).max(5_000).optional(),
  synthesisText: z.string().trim().min(1).max(5_000).nullable().optional(),
  groupCode: z.string().trim().max(100).optional(),
  category: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(5_000).optional(),
});

export const reviewDecisionSchema = z.object({
  decision: z.enum(["pending", "kept", "discarded"]),
  takeId: z.string().min(1).optional(),
});

export const bulkReviewSchema = z.object({
  phraseIds: z.array(z.string().min(1)).min(1).max(10_000),
  decision: z.enum(["pending", "kept", "discarded"]),
});

export const exportRequestSchema = z.object({
  projectId: z.string().min(1),
  label: z.string().trim().min(1).max(100).default("Frase Uno audio export"),
});

export type VoiceProfileInput = z.infer<typeof voiceProfileInputSchema>;
export type CreateTtsBatchInput = z.infer<typeof createTtsBatchSchema>;

export type ApiError = {
  code: string;
  message: string;
  retryable: boolean;
  provider?: string;
  providerRequestId?: string;
  details?: Record<string, unknown>;
};
