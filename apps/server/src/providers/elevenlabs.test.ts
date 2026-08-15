import { describe, expect, it, vi } from "vitest";
import { ElevenLabsTtsProvider } from "./elevenlabs.js";
import { ProviderError } from "./types.js";

describe("ElevenLabs HTTP adapter", () => {
  it("validates and maps paginated account voices", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      voices: [{ voice_id: "v1", name: "Mara", description: null, category: "professional", labels: { locale: "es-MX" } }],
      has_more: true,
      next_page_token: "next",
      total_count: 2,
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const provider = new ElevenLabsTtsProvider({ apiKey: "secret", baseUrl: "https://example.test", fetch: fetcher as typeof fetch });
    await expect(provider.listAccountVoices({ pageSize: 1 })).resolves.toMatchObject({
      voices: [{ id: "v1", name: "Mara", labels: { locale: "es-MX" } }],
      hasMore: true,
      nextPageToken: "next",
    });
  });

  it("classifies 429 as retryable and respects Retry-After", async () => {
    const fetcher = vi.fn(async () => new Response("too many", {
      status: 429,
      headers: { "retry-after": "2", "request-id": "req-1" },
    }));
    const provider = new ElevenLabsTtsProvider({ apiKey: "secret", baseUrl: "https://example.test", fetch: fetcher as typeof fetch });
    try {
      await provider.synthesize({
        text: "Hola", voiceId: "v1", modelId: "m1", outputFormat: "mp3_44100_128", languageCode: "es",
        settings: { stability: 0.5, similarityBoost: 0.75, style: 0, speed: 1, useSpeakerBoost: true }, seed: 1,
      });
      throw new Error("Expected provider error");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as ProviderError).apiError).toMatchObject({ retryable: true, providerRequestId: "req-1" });
      expect((error as ProviderError).retryAfterMs).toBe(2_000);
      expect((error as ProviderError).concurrencyLimited).toBe(true);
    }
  });

  it("classifies 422 as permanent", async () => {
    const provider = new ElevenLabsTtsProvider({
      apiKey: "secret",
      baseUrl: "https://example.test",
      fetch: (async () => new Response("invalid", { status: 422 })) as typeof fetch,
    });
    await expect(provider.testConnection()).rejects.toMatchObject({ apiError: { retryable: false } });
  });

  it("maps an API key ID used as a key to a safe actionable error", async () => {
    const configuredValue = "configured-key-id";
    const upstreamSecret = "sk_upstream-body-secret";
    const provider = new ElevenLabsTtsProvider({
      apiKey: configuredValue,
      baseUrl: "https://example.test",
      fetch: (async () => new Response(JSON.stringify({
        detail: {
          code: "invalid_api_key",
          status: "api_key_id_used_as_api_key",
          message: `API key ID used as API key: ${configuredValue}`,
        },
        api_key: upstreamSecret,
      }), { status: 400, headers: { "request-id": "req-invalid-key" } })) as typeof fetch,
    });

    try {
      await provider.listSharedVoices({ pageSize: 1 });
      throw new Error("Expected provider error");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderError);
      const providerError = error as ProviderError;
      expect(providerError.statusCode).toBe(400);
      expect(providerError.apiError).toMatchObject({
        code: "ELEVENLABS_INVALID_API_KEY",
        message: expect.stringContaining("starts with sk_"),
        retryable: false,
        providerRequestId: "req-invalid-key",
      });
      expect(providerError.apiError.details).toBeUndefined();
      expect(JSON.stringify(providerError.apiError)).not.toContain(configuredValue);
      expect(JSON.stringify(providerError.apiError)).not.toContain(upstreamSecret);
      expect(JSON.stringify(providerError.apiError)).not.toContain("api_key_id_used_as_api_key");
    }
  });

  it("preserves generic provider handling while redacting structured error secrets", async () => {
    const configuredValue = "configured-secret";
    const upstreamSecret = "sk_upstream-body-secret";
    const provider = new ElevenLabsTtsProvider({
      apiKey: configuredValue,
      baseUrl: "https://example.test",
      fetch: (async () => new Response(JSON.stringify({
        detail: { code: "bad_request", status: "invalid_parameter", message: `Bad value ${configuredValue}` },
        api_key: upstreamSecret,
      }), { status: 400 })) as typeof fetch,
    });

    try {
      await provider.listSharedVoices({ pageSize: 1 });
      throw new Error("Expected provider error");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderError);
      const apiError = (error as ProviderError).apiError;
      expect(apiError).toMatchObject({
        code: "ELEVENLABS_400",
        message: "ElevenLabs returned HTTP 400.",
        retryable: false,
        details: {
          response: {
            detail: { code: "bad_request", status: "invalid_parameter", message: "Bad value [REDACTED]" },
            api_key: "[REDACTED]",
          },
        },
      });
      expect(JSON.stringify(apiError)).not.toContain(configuredValue);
      expect(JSON.stringify(apiError)).not.toContain(upstreamSecret);
    }
  });

  it("falls back to text length for missing character cost and maps raw PCM MIME", async () => {
    const provider = new ElevenLabsTtsProvider({
      apiKey: "secret",
      baseUrl: "https://example.test",
      fetch: (async () => new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      })) as typeof fetch,
    });
    await expect(provider.synthesize({
      text: "Hola", voiceId: "v1", modelId: "m1", outputFormat: "pcm_44100", languageCode: "es",
      settings: { stability: 0.5, similarityBoost: 0.75, style: 0, speed: 1, useSpeakerBoost: true }, seed: 1,
    })).resolves.toMatchObject({ mimeType: "audio/pcm", extension: "pcm", actualUnits: 4 });
  });

  it("browses and normalizes Shared Voices with the configured server-side key", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      voices: [
        {
          public_owner_id: "owner-1",
          voice_id: "shared-1",
          name: "Sol",
          accent: "mexican",
          gender: "female",
          age: "young",
          descriptive: "warm",
          use_case: ["conversational", "clear"],
          category: "professional",
          language: null,
          description: null,
          preview_url: "https://storage.googleapis.com/eleven-public-prod/voice-library/sol.mp3?version=1",
          verified_languages: [{ language: "es", locale: "es-MX" }, { language: "es" }],
          featured: true,
          free_users_allowed: true,
          live_moderation_enabled: true,
          rate: "0.25",
        },
        {
          public_owner_id: "owner-2",
          voice_id: "shared-2",
          name: "Unsafe preview",
          preview_url: "https://storage.googleapis.com.evil.example/eleven-public-prod/audio.mp3",
        },
      ],
      has_more: true,
      total_count: 10,
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const provider = new ElevenLabsTtsProvider({
      apiKey: "must-never-leak",
      baseUrl: "https://api.elevenlabs.test",
      fetch: fetcher as typeof fetch,
    });

    await expect(provider.listSharedVoices({
      page: 2,
      pageSize: 24,
      search: "Sol",
      language: "es",
      useCases: ["conversational", "narration"],
      featured: false,
      sort: "trending",
    })).resolves.toMatchObject({
      page: 2,
      pageSize: 24,
      hasMore: true,
      totalCount: 10,
      voices: [
        {
          publicOwnerId: "owner-1",
          voiceId: "shared-1",
          name: "Sol",
          descriptive: ["warm"],
          useCase: ["conversational", "clear"],
          language: "es",
          locale: "es-MX",
          previewUrl: "https://storage.googleapis.com/eleven-public-prod/voice-library/sol.mp3?version=1",
          verifiedLanguages: ["es"],
          featured: true,
          freeUsersAllowed: true,
          liveModerationEnabled: true,
          rate: 0.25,
        },
        { previewUrl: null },
      ],
    });

    const [input, init] = fetcher.mock.calls[0] ?? [];
    const url = new URL(String(input));
    expect(url.pathname).toBe("/v1/shared-voices");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("page_size")).toBe("24");
    expect(url.searchParams.get("featured")).toBe("false");
    expect(url.searchParams.getAll("use_cases")).toEqual(["conversational", "narration"]);
    expect(new Headers(init?.headers).get("xi-api-key")).toBe("must-never-leak");
  });

  it("attempts Shared Voice browsing without credentials when no key is configured", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      voices: [],
      has_more: false,
      total_count: 0,
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const provider = new ElevenLabsTtsProvider({ apiKey: "", baseUrl: "https://api.elevenlabs.test", fetch: fetcher as typeof fetch });

    await expect(provider.listSharedVoices({ page: 0, pageSize: 1 })).resolves.toMatchObject({
      voices: [],
      totalCount: 0,
    });
    const [, init] = fetcher.mock.calls[0] ?? [];
    expect(new Headers(init?.headers).has("xi-api-key")).toBe(false);
  });

  it("returns a clear setup error when keyless Shared Voice browsing is rejected", async () => {
    const provider = new ElevenLabsTtsProvider({
      apiKey: "",
      baseUrl: "https://api.elevenlabs.test",
      fetch: (async () => new Response("unauthorized", { status: 401 })) as typeof fetch,
    });
    await expect(provider.listSharedVoices({})).rejects.toMatchObject({
      statusCode: 401,
      apiError: {
        code: "ELEVENLABS_SHARED_LIBRARY_AUTH_REQUIRED",
        message: expect.stringContaining("requires ELEVENLABS_API_KEY"),
      },
    });
  });

  it("adds an explicitly selected Shared Voice with server-side authentication", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(
      JSON.stringify({ voice_id: "account-voice-1" }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    const provider = new ElevenLabsTtsProvider({ apiKey: "secret", baseUrl: "https://api.elevenlabs.test", fetch: fetcher as typeof fetch });
    await expect(provider.addSharedVoice("owner_1", "shared-1", { newName: "Sol selected", bookmarked: true }))
      .resolves.toEqual({ voiceId: "account-voice-1" });

    const [input, init] = fetcher.mock.calls[0] ?? [];
    expect(String(input)).toBe("https://api.elevenlabs.test/v1/voices/add/owner_1/shared-1");
    expect(new Headers(init?.headers).get("xi-api-key")).toBe("secret");
    expect(JSON.parse(String(init?.body))).toEqual({ new_name: "Sol selected", bookmarked: true });
  });

  it("explains that adding a Shared Voice requires a configured key", async () => {
    const fetcher = vi.fn();
    const provider = new ElevenLabsTtsProvider({ apiKey: "", baseUrl: "https://api.elevenlabs.test", fetch: fetcher as typeof fetch });
    await expect(provider.addSharedVoice("owner", "voice", { newName: "Voice" })).rejects.toMatchObject({
      apiError: { code: "ELEVENLABS_NOT_CONFIGURED", message: expect.stringContaining("requires ELEVENLABS_API_KEY") },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("proxies byte-range Shared Voice previews without credentials", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(new Uint8Array([1, 2, 3]), {
      status: 206,
      headers: {
        "content-type": "audio/mpeg",
        "content-length": "3",
        "content-range": "bytes 0-2/20",
        "accept-ranges": "bytes",
      },
    }));
    const provider = new ElevenLabsTtsProvider({ apiKey: "must-never-leak", baseUrl: "https://api.elevenlabs.test", fetch: fetcher as typeof fetch });
    await expect(provider.fetchSharedVoicePreview(
      "https://storage.googleapis.com/eleven-public-prod/voice-library/preview.mp3?token=public",
      "bytes=0-2",
    )).resolves.toMatchObject({
      audio: new Uint8Array([1, 2, 3]),
      mimeType: "audio/mpeg",
      status: 206,
      acceptRanges: "bytes",
      contentRange: "bytes 0-2/20",
    });

    const [input, init] = fetcher.mock.calls[0] ?? [];
    expect(String(input)).toContain("storage.googleapis.com/eleven-public-prod/");
    expect(init?.redirect).toBe("manual");
    expect(new Headers(init?.headers).get("range")).toBe("bytes=0-2");
    expect(new Headers(init?.headers).has("xi-api-key")).toBe(false);
  });

  it.each([
    { label: "ID3", audio: new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]) },
    { label: "MPEG frame", audio: new Uint8Array([0xff, 0xfb, 0x90, 0x64]) },
  ])("accepts a text/plain MP3 preview with a valid $label signature", async ({ audio }) => {
    const fetcher = vi.fn(async () => new Response(audio, {
      status: 206,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-length": String(audio.byteLength),
        "content-range": `bytes 0-${audio.byteLength - 1}/1000`,
        "accept-ranges": "bytes",
      },
    }));
    const provider = new ElevenLabsTtsProvider({ apiKey: "secret", baseUrl: "https://api.elevenlabs.test", fetch: fetcher as typeof fetch });

    await expect(provider.fetchSharedVoicePreview(
      "https://storage.googleapis.com/eleven-public-prod/voice-library/mislabeled.mp3",
      `bytes=0-${audio.byteLength - 1}`,
    )).resolves.toMatchObject({ audio, mimeType: "audio/mpeg", status: 206 });
  });

  it("uses WAV magic for a text/plain preview even when the approved path ends in .mp3", async () => {
    const audio = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00,
      0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20,
    ]);
    const provider = new ElevenLabsTtsProvider({
      apiKey: "secret",
      baseUrl: "https://api.elevenlabs.test",
      fetch: (async () => new Response(audio, {
        status: 206,
        headers: {
          "content-type": "text/plain",
          "content-range": `bytes 0-${audio.byteLength - 1}/454700`,
        },
      })) as typeof fetch,
    });

    await expect(provider.fetchSharedVoicePreview(
      "https://storage.googleapis.com/eleven-public-prod/voice-library/articulate-professor.mp3",
      `bytes=0-${audio.byteLength - 1}`,
    )).resolves.toMatchObject({ audio, mimeType: "audio/wav", status: 206 });
  });

  it("allows a nonzero text/plain MP3 range only through the approved audio path", async () => {
    const audio = new Uint8Array([0x10, 0x20, 0x30]);
    const provider = new ElevenLabsTtsProvider({
      apiKey: "secret",
      baseUrl: "https://api.elevenlabs.test",
      fetch: (async () => new Response(audio, {
        status: 206,
        headers: { "content-type": "text/plain", "content-range": "bytes 100-102/1000" },
      })) as typeof fetch,
    });
    await expect(provider.fetchSharedVoicePreview(
      "https://storage.googleapis.com/eleven-public-prod/voice-library/mislabeled.mp3",
      "bytes=100-102",
    )).resolves.toMatchObject({ audio, mimeType: "audio/mpeg", status: 206 });
  });

  it.each([
    {
      label: "fake MP3 bytes",
      url: "https://storage.googleapis.com/eleven-public-prod/voice-library/fake.mp3",
      contentType: "text/plain",
      audio: new TextEncoder().encode("not audio"),
    },
    {
      label: "non-audio extension",
      url: "https://storage.googleapis.com/eleven-public-prod/voice-library/fake.txt",
      contentType: "text/plain",
      audio: new Uint8Array([0x49, 0x44, 0x33, 0x04]),
    },
    {
      label: "HTML content type",
      url: "https://storage.googleapis.com/eleven-public-prod/voice-library/fake.mp3",
      contentType: "text/html",
      audio: new Uint8Array([0x49, 0x44, 0x33, 0x04]),
    },
  ])("rejects mislabeled preview content with $label", async ({ url, contentType, audio }) => {
    const provider = new ElevenLabsTtsProvider({
      apiKey: "secret",
      baseUrl: "https://api.elevenlabs.test",
      fetch: (async () => new Response(audio, { status: 200, headers: { "content-type": contentType } })) as typeof fetch,
    });
    await expect(provider.fetchSharedVoicePreview(url)).rejects.toMatchObject({
      statusCode: 502,
      apiError: { code: "ELEVENLABS_INVALID_AUDIO" },
    });
  });

  it("rejects preview SSRF and redirects before following them", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } }));
    const provider = new ElevenLabsTtsProvider({ apiKey: "secret", baseUrl: "https://api.elevenlabs.test", fetch: fetcher as typeof fetch });
    const unsafeUrls = [
      "http://storage.googleapis.com/eleven-public-prod/preview.mp3",
      "https://storage.googleapis.com.evil.example/eleven-public-prod/preview.mp3",
      "https://user@storage.googleapis.com/eleven-public-prod/preview.mp3",
      "https://storage.googleapis.com/another-bucket/preview.mp3",
      "https://127.0.0.1/eleven-public-prod/preview.mp3",
    ];
    for (const url of unsafeUrls) {
      await expect(provider.fetchSharedVoicePreview(url)).rejects.toMatchObject({
        apiError: { code: "UNSAFE_SHARED_VOICE_PREVIEW_URL" },
      });
    }
    expect(fetcher).not.toHaveBeenCalled();

    await expect(provider.fetchSharedVoicePreview(
      "https://storage.googleapis.com/eleven-public-prod/voice-library/preview.mp3",
    )).rejects.toMatchObject({ apiError: { code: "ELEVENLABS_PREVIEW_REDIRECT" } });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("rejects malformed preview ranges and declared audio larger than the proxy cap", async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1]), {
      status: 200,
      headers: { "content-type": "audio/mpeg", "content-length": String(12 * 1024 * 1024 + 1) },
    }));
    const provider = new ElevenLabsTtsProvider({ apiKey: "secret", baseUrl: "https://api.elevenlabs.test", fetch: fetcher as typeof fetch });
    const previewUrl = "https://storage.googleapis.com/eleven-public-prod/voice-library/preview.mp3";

    await expect(provider.fetchSharedVoicePreview(previewUrl, "items=0-10")).rejects.toMatchObject({
      statusCode: 416,
      apiError: { code: "INVALID_RANGE" },
    });
    await expect(provider.fetchSharedVoicePreview(previewUrl, "bytes=-")).rejects.toMatchObject({
      statusCode: 416,
      apiError: { code: "INVALID_RANGE" },
    });
    expect(fetcher).not.toHaveBeenCalled();

    await expect(provider.fetchSharedVoicePreview(previewUrl)).rejects.toMatchObject({
      statusCode: 502,
      apiError: { code: "ELEVENLABS_PREVIEW_TOO_LARGE" },
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
