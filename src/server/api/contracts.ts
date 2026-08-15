import { z } from "zod";

const identifierSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const nonemptyFilterSchema = z.string().trim().min(1).max(100);
const booleanQuerySchema = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean());
const stringListQuerySchema = z.union([
  nonemptyFilterSchema,
  z.array(nonemptyFilterSchema).min(1).max(20),
]).transform((value) => Array.isArray(value) ? value : [value]);

export const accountVoiceQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  nextPageToken: z.string().trim().min(1).max(1_000).optional(),
  voiceType: z.enum(["personal", "community", "default", "workspace", "non-default", "non-community", "saved"]).optional(),
  category: z.enum(["premade", "cloned", "generated", "professional"]).optional(),
}).strict();

export const sharedVoiceQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(0).max(100_000).default(0),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
  category: z.enum(["professional", "famous", "high_quality"]).optional(),
  gender: nonemptyFilterSchema.optional(),
  age: nonemptyFilterSchema.optional(),
  accent: nonemptyFilterSchema.optional(),
  language: nonemptyFilterSchema.optional(),
  locale: nonemptyFilterSchema.optional(),
  useCase: stringListQuerySchema.optional(),
  useCases: stringListQuerySchema.optional(),
  descriptive: stringListQuerySchema.optional(),
  descriptives: stringListQuerySchema.optional(),
  featured: booleanQuerySchema.optional(),
  minNoticePeriodDays: z.coerce.number().int().min(0).max(36_500).optional(),
  includeCustomRates: booleanQuerySchema.optional(),
  includeLiveModerated: booleanQuerySchema.optional(),
  readerAppEnabled: booleanQuerySchema.optional(),
  ownerId: identifierSchema.optional(),
  sort: z.enum(["created_date", "usage_character_count_1y", "trending", "cloned_by_count"]).optional(),
}).strict();

export const sharedVoicePathSchema = z.object({
  publicOwnerId: identifierSchema,
  voiceId: identifierSchema,
}).strict();

export const previewQuerySchema = z.object({
  url: z.string().trim().min(1).max(3_000),
}).strict();

export const addSharedVoiceBodySchema = z.object({
  newName: z.string().trim().min(1).max(100).optional(),
  bookmarked: z.boolean().optional(),
}).strict();

export const speechBodySchema = z.object({
  text: z.string().min(1).max(5_000).refine((value) => value.trim().length > 0, "Text cannot contain only whitespace."),
  voiceId: identifierSchema,
  modelId: z.enum(["eleven_multilingual_v2", "eleven_v3", "eleven_flash_v2_5"]),
  languageCode: z.string().regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/).max(35).nullable().optional(),
  outputFormat: z.enum(["mp3_44100_128", "mp3_44100_192"]),
  seed: z.number().int().min(0).max(4_294_967_295).optional(),
  settings: z.object({
    stability: z.number().min(0).max(1),
    similarityBoost: z.number().min(0).max(1),
    style: z.number().min(0).max(1),
    speed: z.number().min(0.7).max(1.2),
    useSpeakerBoost: z.boolean(),
  }).strict(),
}).strict();

export type AccountVoiceQueryInput = z.infer<typeof accountVoiceQuerySchema>;
export type SharedVoiceQueryInput = z.infer<typeof sharedVoiceQuerySchema>;
export type SharedVoicePathInput = z.infer<typeof sharedVoicePathSchema>;
export type AddSharedVoiceBodyInput = z.infer<typeof addSharedVoiceBodySchema>;
export type SpeechBodyInput = z.infer<typeof speechBodySchema>;
