// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateSpeech } from "./api";
import { PhraseWorkbench } from "./PhraseWorkbench";
import { DEFAULT_RECIPE } from "./types";
import { buildAudioExport, shareOrDownload } from "./zip";

vi.mock("./api", async (loadOriginal) => {
  const original = await loadOriginal<typeof import("./api")>();
  return { ...original, generateSpeech: vi.fn(() => new Promise<Blob>(() => undefined)) };
});

vi.mock("./zip", async (loadOriginal) => {
  const original = await loadOriginal<typeof import("./zip")>();
  return {
    ...original,
    buildAudioExport: vi.fn(async () => new Blob(["zip"], { type: "application/zip" })),
    shareOrDownload: vi.fn(async () => "downloaded" as const),
  };
});

describe("paid batch guard", () => {
  beforeEach(() => {
    vi.mocked(generateSpeech).mockReset();
    vi.mocked(generateSpeech).mockImplementation(() => new Promise<Blob>(() => undefined));
    vi.mocked(buildAudioExport).mockReset();
    vi.mocked(buildAudioExport).mockResolvedValue(new Blob(["zip"], { type: "application/zip" }));
    vi.mocked(shareOrDownload).mockReset();
    vi.mocked(shareOrDownload).mockResolvedValue("downloaded");
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: vi.fn() });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("starts one request for one phrase after rapid generate taps", () => {
    const recipe = { ...structuredClone(DEFAULT_RECIPE), voiceId: "voice-a" };
    render(<StrictMode><PhraseWorkbench recipe={recipe} onNotice={vi.fn()} /></StrictMode>);
    fireEvent.change(screen.getByLabelText(/Paste phrases/), { target: { value: "Hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview lines" }));
    fireEvent.click(screen.getByRole("button", { name: "Add 1 valid phrases" }));
    const button = screen.getByRole("button", { name: "Generate next 1" });
    button.click();
    button.click();
    expect(generateSpeech).toHaveBeenCalledTimes(1);
  });

  it("shows character cost and catches an oversized paste inside the page", () => {
    const recipe = { ...structuredClone(DEFAULT_RECIPE), voiceId: "voice-a" };
    render(<PhraseWorkbench recipe={recipe} onNotice={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Paste phrases/), { target: { value: "Hello\nWorld!" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview lines" }));
    fireEvent.click(screen.getByRole("button", { name: "Add 2 valid phrases" }));
    expect(screen.getByText("11 total characters")).toBeInTheDocument();
    expect(screen.getByText(/next chunk will send 2 paid requests totaling 11 characters/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Paste phrases/), { target: { value: "x\n".repeat(100_001) } });
    fireEvent.click(screen.getByRole("button", { name: "Preview lines" }));
    expect(screen.getByText(/Imports are limited to 100,000 rows/)).toBeInTheDocument();
  });

  it("keeps the original chunk membership while a failed clip is retried", async () => {
    vi.mocked(generateSpeech)
      .mockResolvedValueOnce(new Blob(["one"], { type: "audio/mpeg" }))
      .mockRejectedValueOnce(new Error("provider failed"))
      .mockResolvedValueOnce(new Blob(["two"], { type: "audio/mpeg" }));
    const recipe = { ...structuredClone(DEFAULT_RECIPE), voiceId: "voice-a" };
    const view = render(<PhraseWorkbench recipe={recipe} onNotice={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Paste phrases/), { target: { value: "One\nTwo" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview lines" }));
    fireEvent.click(screen.getByRole("button", { name: "Add 2 valid phrases" }));
    fireEvent.click(screen.getByRole("button", { name: "Generate next 2" }));

    const retry = await screen.findByRole("button", { name: "Paid retry using original recipe" });
    expect(screen.getByRole("button", { name: "Share / download last chunk (1)" })).toBeInTheDocument();
    expect(screen.getByText(/could double-charge if the earlier response was lost/i)).toBeInTheDocument();
    const changedRecipe = structuredClone(recipe);
    changedRecipe.settings.speed = 0.8;
    view.rerender(<PhraseWorkbench recipe={changedRecipe} onNotice={vi.fn()} />);
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByRole("button", { name: "Share / download last chunk (2)" })).toBeInTheDocument());
    expect(generateSpeech).toHaveBeenCalledTimes(3);
    expect(vi.mocked(generateSpeech).mock.calls[2]?.[1].settings.speed).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Share / download last chunk (2)" }));
    await waitFor(() => expect(buildAudioExport).toHaveBeenCalledTimes(1));
    const exportedJobs = vi.mocked(buildAudioExport).mock.calls[0]?.[0] ?? [];
    expect(exportedJobs).toHaveLength(2);
    expect(exportedJobs.every((job) => job.recipeSnapshot?.settings.speed === 1)).toBe(true);
  });
});
