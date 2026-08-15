import { describe, expect, it } from "vitest";
import { normalizeHealth, normalizeSharedVoicePage } from "./normalize";

describe("normalizeSharedVoicePage", () => {
  it("normalizes provider fields and pagination without retaining unknown data", () => {
    const page = normalizeSharedVoicePage({
      voices: [{
        public_owner_id: "owner_123",
        voice_id: "voice_456",
        name: "Marisol",
        accent: "mexican",
        gender: "female",
        age: "middle aged",
        descriptive: ["warm", "conversational"],
        use_case: ["conversational"],
        category: "professional",
        language: "es",
        locale: "es-MX",
        description: "Warm Mexican Spanish delivery.",
        preview_url: "https://storage.googleapis.com/eleven-public-prod/example.mp3",
        verified_languages: [{ language: "es", locale: "es-MX", accent: "mexican" }],
        featured: true,
        free_users_allowed: false,
        live_moderation_enabled: true,
        rate: "2",
        secret_provider_field: "ignored",
      }],
      page: 2,
      page_size: 24,
      has_more: true,
      total_count: 91,
    });

    expect(page).toEqual({
      voices: [{
        publicOwnerId: "owner_123",
        voiceId: "voice_456",
        name: "Marisol",
        accent: "mexican",
        gender: "female",
        age: "middle aged",
        descriptive: ["warm", "conversational"],
        useCase: ["conversational"],
        category: "professional",
        language: "es",
        locale: "es-MX",
        description: "Warm Mexican Spanish delivery.",
        previewUrl: "https://storage.googleapis.com/eleven-public-prod/example.mp3",
        verifiedLanguages: ["es · es-MX · mexican"],
        featured: true,
        freeUsersAllowed: false,
        liveModerationEnabled: true,
        rate: 2,
      }],
      page: 2,
      pageSize: 24,
      hasMore: true,
      totalCount: 91,
    });
  });

  it("uses safe fallbacks for a minimal response", () => {
    expect(normalizeSharedVoicePage({ voices: [], hasMore: false }, 0, 12)).toEqual({
      voices: [],
      page: 0,
      pageSize: 12,
      hasMore: false,
      totalCount: null,
    });
  });
});

describe("normalizeHealth", () => {
  it("does not mark an ElevenLabs provider live when its key is missing", () => {
    expect(normalizeHealth({
      ok: true,
      database: { ok: true },
      providerMode: "elevenlabs",
      provider: { mode: "elevenlabs", configured: false },
    }).providerMode).toBe("unconfigured");
  });
});
