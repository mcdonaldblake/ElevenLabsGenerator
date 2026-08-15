import { describe, expect, it } from "vitest";
import { ApiRequestError } from "../lib/api";
import { classifySharedVoiceBrowseError } from "./SharedVoiceBrowser";

describe("classifySharedVoiceBrowseError", () => {
  it("classifies an explicit invalid-key code as an authentication setup error", () => {
    const error = new ApiRequestError("Invalid API key", 400, "ELEVENLABS_INVALID_API_KEY", false);
    expect(classifySharedVoiceBrowseError(error)).toBe("authentication");
  });

  it("classifies HTTP 401 as authentication and HTTP 403 as plan or permission access", () => {
    expect(classifySharedVoiceBrowseError(new ApiRequestError("Unauthorized", 401, "ELEVENLABS_401", false))).toBe("authentication");
    expect(classifySharedVoiceBrowseError(new ApiRequestError("Forbidden", 403, "ELEVENLABS_403", false))).toBe("permissions");
  });

  it("leaves unrelated failures generic", () => {
    expect(classifySharedVoiceBrowseError(new ApiRequestError("Unavailable", 503, "ELEVENLABS_503", true))).toBe("other");
  });
});
