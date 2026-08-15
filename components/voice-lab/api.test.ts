import { afterEach, describe, expect, it, vi } from "vitest";
import { getAccountVoices } from "./api";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

describe("My Voices pagination", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("follows every provider page token and deduplicates Voice IDs", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        voices: [{ id: "one", name: "One" }, { id: "shared", name: "Old name" }],
        hasMore: true,
        nextPageToken: "page-two",
        totalCount: 3,
      }))
      .mockResolvedValueOnce(jsonResponse({
        voices: [{ id: "shared", name: "New name" }, { id: "two", name: "Two" }],
        hasMore: false,
        nextPageToken: null,
        totalCount: 3,
      }));
    vi.stubGlobal("fetch", request);

    const voices = await getAccountVoices();
    expect(voices.map((voice) => [voice.id, voice.name])).toEqual([["one", "One"], ["shared", "New name"], ["two", "Two"]]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]?.[0]).toBe("/api/voices/account?pageSize=100");
    expect(request.mock.calls[1]?.[0]).toBe("/api/voices/account?pageSize=100&nextPageToken=page-two");
  });

  it("stops a repeated page-token loop", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse({ voices: [], hasMore: true, nextPageToken: "repeat" }))
      .mockResolvedValueOnce(jsonResponse({ voices: [], hasMore: true, nextPageToken: "repeat" })));

    await expect(getAccountVoices()).rejects.toMatchObject({ code: "INVALID_VOICE_PAGE" });
  });
});
