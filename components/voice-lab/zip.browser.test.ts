// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shareOrDownload } from "./zip";

describe("iPhone share and download fallback", () => {
  const createObjectURL = vi.fn(() => "blob:download");
  const revokeObjectURL = vi.fn();
  let click: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses Web Share without creating a download when file sharing succeeds", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { canShare: vi.fn(() => true), share });

    await expect(shareOrDownload(new Blob(["audio"], { type: "audio/mpeg" }), "clip.mp3", "Clip")).resolves.toBe("shared");
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ title: "Clip", files: [expect.any(File)] }));
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  it("returns canceled without downloading when the share sheet is dismissed", async () => {
    const share = vi.fn().mockRejectedValue(new DOMException("Canceled", "AbortError"));
    vi.stubGlobal("navigator", { canShare: vi.fn(() => true), share });

    await expect(shareOrDownload(new Blob(["zip"], { type: "application/zip" }), "batch.zip", "Batch")).resolves.toBe("canceled");
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  it.each([
    ["unsupported", undefined],
    ["share error", new Error("Share failed")],
  ])("downloads and revokes the object URL after %s", async (_label, shareError) => {
    const share = shareError === undefined ? undefined : vi.fn().mockRejectedValue(shareError);
    vi.stubGlobal("navigator", { canShare: vi.fn(() => share !== undefined), ...(share ? { share } : {}) });

    await expect(shareOrDownload(new Blob(["zip"], { type: "application/zip" }), "batch.zip", "Batch")).resolves.toBe("downloaded");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:download");
  });
});
