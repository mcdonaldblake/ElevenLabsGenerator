import { describe, expect, it } from "vitest";
import {
  comparisonPhrase,
  jobFingerprint,
  normalizePhrase,
  safePathSegment,
  stablePhraseId,
} from "./index.js";

describe("phrase normalization", () => {
  it("normalizes punctuation and whitespace without corrupting Spanish input", () => {
    expect(normalizePhrase("  ¡Eso   es!  Seguimos. ")).toBe("eso es seguimos");
    expect(comparisonPhrase("¿Cómo estás?")).toBe("como estas");
  });
});

describe("stablePhraseId", () => {
  it("uses a safe normalized supplied ID", () => {
    expect(stablePhraseId("Correct Continue 001", "abc", 1)).toBe("correct-continue-001");
  });

  it("assigns the same source-derived ID every time", () => {
    const first = stablePhraseId(undefined, "0123456789abcdef", 27);
    const second = stablePhraseId(undefined, "0123456789abcdef", 27);
    expect(first).toBe("phrase-0123456789-000027");
    expect(second).toBe(first);
  });

  it("never returns a traversable path segment", () => {
    expect(safePathSegment("../../Mara phrase")).toBe("mara-phrase");
  });
});

describe("jobFingerprint", () => {
  const recipe = {
    synthesisText: "Eso es. Seguimos.",
    voiceProfileVersionId: "vp_1",
    voiceId: "voice_1",
    modelId: "eleven_multilingual_v2",
    outputFormat: "mp3_44100_128",
    languageCode: "es",
    settings: {
      stability: 0.5,
      similarityBoost: 0.75,
      style: 0,
      speed: 1,
      useSpeakerBoost: true,
    },
    seed: 7,
  } as const;

  it("is deterministic and changes when the recipe changes", () => {
    expect(jobFingerprint(recipe)).toBe(jobFingerprint(recipe));
    expect(jobFingerprint({ ...recipe, seed: 8 })).not.toBe(jobFingerprint(recipe));
    expect(jobFingerprint({ ...recipe, synthesisText: "Muy bien." })).not.toBe(jobFingerprint(recipe));
  });
});
