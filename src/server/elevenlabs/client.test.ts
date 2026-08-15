import { describe, expect, it, vi } from "vitest";
import { ElevenLabsClient, MAX_AUDIO_BYTES } from "./client";

describe("ElevenLabsClient", () => {
  it("maps Shared Voice results and sends supported filters with server-side authentication", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      voices: [{
        public_owner_id: "owner-1",
        voice_id: "voice-1",
        name: "Sol",
        accent: "mexican",
        gender: "female",
        age: "young",
        descriptive: "warm",
        use_case: ["conversational", "narration"],
        category: "professional",
        language: null,
        locale: null,
        description: "Warm and clear",
        preview_url: "https://storage.googleapis.com/eleven-public-prod/voices/sol.mp3?public=1",
        verified_languages: [{ language: "es", locale: "es-MX" }],
        featured: true,
        free_users_allowed: true,
        live_moderation_enabled: false,
        rate: "0.25",
      }],
      has_more: true,
      total_count: 12,
    }), { headers: { "content-type": "application/json" } }));
    const client = new ElevenLabsClient({ apiKey: "server-secret", apiOrigin: "https://api.test", fetch: fetcher as typeof fetch });

    await expect(client.listSharedVoices({
      page: 2,
      pageSize: 24,
      search: "Sol",
      language: "es",
      useCases: ["conversational"],
      featured: false,
      sort: "trending",
    })).resolves.toMatchObject({
      voices: [{
        publicOwnerId: "owner-1",
        voiceId: "voice-1",
        name: "Sol",
        descriptive: ["warm"],
        useCase: ["conversational", "narration"],
        language: "es",
        locale: "es-MX",
        rate: 0.25,
      }],
      page: 2,
      pageSize: 24,
      hasMore: true,
      totalCount: 12,
    });

    const [rawUrl, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const url = new URL(rawUrl);
    expect(url.pathname).toBe("/v1/shared-voices");
    expect(url.searchParams.getAll("use_cases")).toEqual(["conversational"]);
    expect(url.searchParams.get("featured")).toBe("false");
    expect(new Headers(init.headers).get("xi-api-key")).toBe("server-secret");
  });

  it("never exposes the configured key or the upstream error body", async () => {
    const secret = "sk-do-not-return";
    const client = new ElevenLabsClient({
      apiKey: secret,
      apiOrigin: "https://api.test",
      fetch: (async () => new Response(JSON.stringify({
        detail: { code: "bad_request", message: `Bad ${secret}` },
        api_key: "another-upstream-secret",
      }), { status: 400 })) as typeof fetch,
    });

    try {
      await client.listAccountVoices({ pageSize: 10 });
      throw new Error("Expected the provider request to fail");
    } catch (error) {
      const serialized = JSON.stringify(error);
      expect(serialized).not.toContain(secret);
      expect(serialized).not.toContain("another-upstream-secret");
      expect(error).toMatchObject({
        status: 400,
        publicError: { code: "ELEVENLABS_400", message: "ElevenLabs returned HTTP 400." },
      });
    }
  });

  it("maps invalid API-key failures to an actionable sanitized error", async () => {
    const configuredValue = "configured-key-id";
    const client = new ElevenLabsClient({
      apiKey: configuredValue,
      apiOrigin: "https://api.test",
      fetch: (async () => new Response(JSON.stringify({
        detail: {
          code: "invalid_api_key",
          status: "api_key_id_used_as_api_key",
          message: `API key ID used as API key: ${configuredValue}`,
        },
      }), { status: 401, headers: { "request-id": "request-invalid-key" } })) as typeof fetch,
    });
    try {
      await client.listAccountVoices({ pageSize: 10 });
      throw new Error("Expected the provider request to fail");
    } catch (error) {
      expect(error).toMatchObject({
        status: 401,
        publicError: {
          code: "ELEVENLABS_INVALID_API_KEY",
          message: "ElevenLabs rejected the configured API key.",
          providerRequestId: "request-invalid-key",
        },
      });
      expect(JSON.stringify(error)).not.toContain(configuredValue);
      expect(JSON.stringify(error)).not.toContain("api_key_id_used_as_api_key");
    }
  });

  it("adds a selected Shared Voice with the secret only in the upstream header", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ voice_id: "account-voice-1" }), {
      headers: { "content-type": "application/json" },
    }));
    const client = new ElevenLabsClient({ apiKey: "secret", apiOrigin: "https://api.test", fetch: fetcher as typeof fetch });
    await expect(client.addSharedVoice("owner-1", "shared-1", { newName: "Sol", bookmarked: true }))
      .resolves.toEqual({ voiceId: "account-voice-1" });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.test/v1/voices/add/owner-1/shared-1");
    expect(new Headers(init.headers).get("xi-api-key")).toBe("secret");
    expect(JSON.parse(String(init.body))).toEqual({ new_name: "Sol", bookmarked: true });
  });

  it("rejects preview SSRF and redirects before following them", async () => {
    const fetcher = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/private" },
    }));
    const client = new ElevenLabsClient({ apiKey: "secret", apiOrigin: "https://api.test", fetch: fetcher as typeof fetch });

    for (const url of [
      "http://storage.googleapis.com/eleven-public-prod/a.mp3",
      "https://storage.googleapis.com.evil.test/eleven-public-prod/a.mp3",
      "https://user@storage.googleapis.com/eleven-public-prod/a.mp3",
      "https://storage.googleapis.com/another-bucket/a.mp3",
      "https://127.0.0.1/eleven-public-prod/a.mp3",
    ]) {
      await expect(client.previewSharedVoice(url)).rejects.toMatchObject({
        publicError: { code: "UNSAFE_SHARED_VOICE_PREVIEW_URL" },
      });
    }
    expect(fetcher).not.toHaveBeenCalled();

    await expect(client.previewSharedVoice(
      "https://storage.googleapis.com/eleven-public-prod/voices/a.mp3",
    )).rejects.toMatchObject({ publicError: { code: "ELEVENLABS_PREVIEW_REDIRECT" } });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("passes one valid byte range through and preserves a validated 206 response", async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([0x49, 0x44, 0x33, 0x04]), {
      status: 206,
      headers: {
        "content-type": "application/octet-stream",
        "content-length": "4",
        "content-range": "bytes 0-3/100",
        "accept-ranges": "bytes",
      },
    }));
    const client = new ElevenLabsClient({ apiKey: "secret", apiOrigin: "https://api.test", fetch: fetcher as typeof fetch });
    const result = await client.previewSharedVoice(
      "https://storage.googleapis.com/eleven-public-prod/voices/a.mp3",
      "bytes=0-3",
    );
    expect(result).toMatchObject({ status: 206, mimeType: "audio/mpeg", contentRange: "bytes 0-3/100" });
    await expect(new Response(result.stream).arrayBuffer()).resolves.toHaveProperty("byteLength", 4);
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("range")).toBe("bytes=0-3");
    expect(new Headers(init.headers).has("xi-api-key")).toBe(false);
    expect(init.redirect).toBe("manual");
  });

  it("rejects malformed/mismatched ranges and audio declared above the cap", async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([0x49, 0x44, 0x33]), {
      status: 206,
      headers: { "content-type": "audio/mpeg", "content-range": "bytes 1-3/100" },
    }));
    const client = new ElevenLabsClient({ apiKey: "secret", apiOrigin: "https://api.test", fetch: fetcher as typeof fetch });
    const url = "https://storage.googleapis.com/eleven-public-prod/voices/a.mp3";
    await expect(client.previewSharedVoice(url, "items=0-3")).rejects.toMatchObject({
      status: 416,
      publicError: { code: "INVALID_RANGE" },
    });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(client.previewSharedVoice(url, "bytes=0-3")).rejects.toMatchObject({
      publicError: { code: "ELEVENLABS_INVALID_AUDIO_RANGE" },
    });

    const oversized = new ElevenLabsClient({
      apiKey: "secret",
      apiOrigin: "https://api.test",
      fetch: (async () => new Response(new Uint8Array([0x49, 0x44, 0x33]), {
        headers: { "content-type": "audio/mpeg", "content-length": String(MAX_AUDIO_BYTES + 1) },
      })) as typeof fetch,
    });
    await expect(oversized.previewSharedVoice(url)).rejects.toMatchObject({
      publicError: { code: "ELEVENLABS_AUDIO_TOO_LARGE" },
    });
  });

  it("sends only the approved speech recipe and streams the MP3 response", async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([0x49, 0x44, 0x33, 0x04]), {
      headers: {
        "content-type": "audio/mpeg",
        "content-length": "4",
        "character-cost": "4",
        "request-id": "request-1",
      },
    }));
    const client = new ElevenLabsClient({ apiKey: "secret", apiOrigin: "https://api.test", fetch: fetcher as typeof fetch });
    const result = await client.synthesize({
      text: "Hola",
      voiceId: "voice-1",
      modelId: "eleven_multilingual_v2",
      languageCode: "es",
      outputFormat: "mp3_44100_128",
      seed: 17,
      settings: { stability: 0.5, similarityBoost: 0.75, style: 0, speed: 1, useSpeakerBoost: true },
    });
    expect(result).toMatchObject({ mimeType: "audio/mpeg", contentLength: 4, characterCost: 4, providerRequestId: "request-1" });
    await expect(new Response(result.stream).arrayBuffer()).resolves.toHaveProperty("byteLength", 4);
    const [rawUrl, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(rawUrl).toBe("https://api.test/v1/text-to-speech/voice-1?output_format=mp3_44100_128");
    expect(new Headers(init.headers).get("xi-api-key")).toBe("secret");
    expect(JSON.parse(String(init.body))).toEqual({
      text: "Hola",
      model_id: "eleven_multilingual_v2",
      language_code: "es",
      seed: 17,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0,
        speed: 1,
        use_speaker_boost: true,
      },
    });
  });
});
