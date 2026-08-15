// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addSharedVoice, getAccountVoices, getSharedVoices } from "./api";
import { VoiceBrowser } from "./VoiceBrowser";

vi.mock("./api", async (loadOriginal) => {
  const original = await loadOriginal<typeof import("./api")>();
  return { ...original, addSharedVoice: vi.fn(), getAccountVoices: vi.fn(), getSharedVoices: vi.fn() };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject; });
  return { promise, resolve, reject };
}

describe("voice preview attempt isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAccountVoices).mockResolvedValue([]);
    vi.mocked(addSharedVoice).mockResolvedValue({ id: "account-returned-id", name: "Alpha", description: "", category: "Shared", previewUrl: null, labels: {} });
    vi.mocked(getSharedVoices).mockResolvedValue({
      page: 0, pageSize: 18, hasMore: false, totalCount: 2,
      voices: ["Alpha", "Beta"].map((name) => ({
        publicOwnerId: "owner", voiceId: name.toLocaleLowerCase(), name,
        accent: "", gender: "", age: "", descriptive: [], useCase: [], category: "", language: "en", locale: null,
        description: "", previewUrl: `https://storage.elevenlabs.io/${name}.mp3`, verifiedLanguages: [], featured: false,
        freeUsersAllowed: true, liveModerationEnabled: false, rate: null,
      })),
    });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("does not attribute a stale A rejection to preview B", async () => {
    const alpha = deferred<void>();
    const beta = deferred<void>();
    vi.spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementationOnce(() => alpha.promise)
      .mockImplementationOnce(() => beta.promise);
    render(<VoiceBrowser selectedVoiceId="" onSelect={vi.fn()} onNotice={vi.fn()} />);

    const alphaButton = await screen.findByRole("button", { name: "Play Alpha preview" });
    const betaButton = screen.getByRole("button", { name: "Play Beta preview" });
    fireEvent.click(alphaButton);
    fireEvent.click(betaButton);
    alpha.reject(new DOMException("stale", "NotAllowedError"));
    beta.resolve();

    await waitFor(() => expect(screen.queryByText("That preview could not play.")).not.toBeInTheDocument());
  });

  it("uses the account Voice ID returned by Add & use", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const onSelect = vi.fn();
    render(<VoiceBrowser selectedVoiceId="" onSelect={onSelect} onNotice={vi.fn()} />);

    const card = (await screen.findByRole("heading", { name: "Alpha" })).closest("article");
    expect(card).not.toBeNull();
    fireEvent.click(within(card as HTMLElement).getByRole("button", { name: "Add & use" }));

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "account-returned-id", name: "Alpha" })));
  });

  it("allows only one Add & use mutation after rapid different selections", async () => {
    const addition = deferred<Awaited<ReturnType<typeof addSharedVoice>>>();
    vi.mocked(addSharedVoice).mockReturnValueOnce(addition.promise);
    const onSelect = vi.fn();
    render(<VoiceBrowser selectedVoiceId="" onSelect={onSelect} onNotice={vi.fn()} />);

    const alphaCard = (await screen.findByRole("heading", { name: "Alpha" })).closest("article") as HTMLElement;
    const betaCard = screen.getByRole("heading", { name: "Beta" }).closest("article") as HTMLElement;
    const alphaAdd = within(alphaCard).getByRole("button", { name: "Add & use" });
    const betaAdd = within(betaCard).getByRole("button", { name: "Add & use" });
    act(() => {
      alphaAdd.click();
      betaAdd.click();
    });

    expect(addSharedVoice).toHaveBeenCalledTimes(1);
    expect(betaAdd).toBeDisabled();
    addition.resolve({ id: "alpha-account-id", name: "Alpha", description: "", category: "Shared", previewUrl: null, labels: {} });
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "alpha-account-id", name: "Alpha" }));
  });
});
