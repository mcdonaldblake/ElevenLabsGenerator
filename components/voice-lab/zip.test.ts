import { describe, expect, it } from "vitest";
import { recipeFingerprint } from "./batch";
import type { PhraseJob, VoiceRecipe } from "./types";
import { DEFAULT_RECIPE } from "./types";
import { audioFilename, buildAudioExport, sanitizeFilename } from "./zip";

const decoder = new TextDecoder();

function storedEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  const entries = new Map<string, Uint8Array>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    entries.set(decoder.decode(bytes.slice(nameStart, nameStart + nameLength)), bytes.slice(dataStart, dataStart + size));
    offset = dataStart + size;
  }
  return entries;
}

function job(text: string, recipe: VoiceRecipe, filename = "", sequence = 1): PhraseJob {
  return {
    key: text,
    sequence,
    id: "shared",
    filename,
    text,
    status: "ready",
    error: null,
    audio: new Blob([`audio:${text}`], { type: "audio/mpeg" }),
    audioUrl: "blob:test",
    recipeFingerprint: recipeFingerprint(recipe),
    recipeSnapshot: recipe,
  };
}

describe("client ZIP exports", () => {
  it("sanitizes application-controlled filenames", () => {
    expect(sanitizeFilename('../bad:name?.mp3', "0001")).toBe("-bad-name-.mp3");
    expect(sanitizeFilename("...", "0001")).toBe("0001");
  });

  it("includes audio, CSV/JSON manifests, and the recipe used for generation", async () => {
    const generatedRecipe = structuredClone(DEFAULT_RECIPE);
    generatedRecipe.voiceId = "voice-a";
    generatedRecipe.settings.speed = 0.82;
    const currentRecipe = structuredClone(generatedRecipe);
    currentRecipe.settings.speed = 1.1;

    const zip = await buildAudioExport([job("Hello", generatedRecipe, "hello"), job("Again", generatedRecipe, "hello")]);
    const entries = storedEntries(new Uint8Array(await zip.arrayBuffer()));
    const exportedRecipe = JSON.parse(decoder.decode(entries.get("recipe.json"))) as VoiceRecipe;
    const manifest = decoder.decode(entries.get("manifest.csv"));

    expect(Array.from(entries.keys())).toEqual(expect.arrayContaining(["audio/hello.mp3", "audio/hello-2.mp3", "manifest.csv", "manifest.json", "recipe.json"]));
    expect(exportedRecipe.settings.speed).toBe(0.82);
    expect(exportedRecipe.settings.speed).not.toBe(currentRecipe.settings.speed);
    expect(manifest).toContain("recipe_fingerprint");
    expect(manifest).toContain("Hello");
  });

  it("refuses to label a mixed-recipe selection as one recipe", async () => {
    const first = structuredClone(DEFAULT_RECIPE);
    const second = structuredClone(DEFAULT_RECIPE);
    second.settings.speed = 0.8;
    await expect(buildAudioExport([job("One", first), job("Two", second)])).rejects.toThrow(/different recipes/);
  });

  it("preserves session sequence names for later chunks and partial subsets", async () => {
    const firstReady = job("Phrase 101", DEFAULT_RECIPE, "", 101);
    firstReady.id = "";
    const laterReady = job("Phrase 103", DEFAULT_RECIPE, "", 103);
    laterReady.id = "";

    expect(audioFilename(firstReady)).toBe("0101.mp3");
    const zip = await buildAudioExport([firstReady, laterReady]);
    const entries = storedEntries(new Uint8Array(await zip.arrayBuffer()));
    const manifest = decoder.decode(entries.get("manifest.csv"));
    expect(Array.from(entries.keys())).toEqual(expect.arrayContaining(["audio/0101.mp3", "audio/0103.mp3"]));
    expect(entries.has("audio/0102.mp3")).toBe(false);
    expect(manifest).toContain("101,,0101.mp3");
    expect(manifest).toContain("103,,0103.mp3");
  });
});
