// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateSpeech } from "./api";
import { RecipeEditor } from "./RecipeEditor";
import { DEFAULT_RECIPE } from "./types";

vi.mock("./api", async (loadOriginal) => {
  const original = await loadOriginal<typeof import("./api")>();
  return { ...original, generateSpeech: vi.fn() };
});

describe("paid test phrase guard", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: vi.fn() });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("starts only one paid request after rapid taps", async () => {
    let finish: ((blob: Blob) => void) | undefined;
    vi.mocked(generateSpeech).mockImplementation(() => new Promise<Blob>((resolve) => { finish = resolve; }));
    const recipe = { ...structuredClone(DEFAULT_RECIPE), voiceId: "voice-a" };
    render(<RecipeEditor recipe={recipe} onChange={vi.fn()} onNotice={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("Type one short phrase…"), { target: { value: "Hello" } });
    const button = screen.getByRole("button", { name: "Generate test" });
    button.click();
    button.click();

    expect(generateSpeech).toHaveBeenCalledTimes(1);
    finish?.(new Blob(["audio"], { type: "audio/mpeg" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Share or download" })).toBeInTheDocument());
  });
});
