import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildAudioMap,
  buildChecksums,
  buildPhrasesCsv,
  outputFileName,
  validateExportAssets,
  type ExportAsset,
} from "./index.js";

const asset: ExportAsset = {
  id: "correct-continue-001",
  phraseId: "phrase_1",
  text: "Eso es. Seguimos.",
  synthesisText: "Eso es. Seguimos.",
  group: "correct-continue",
  category: "acknowledgement",
  src: "audio/correct-continue/correct-continue-001.mp3",
  mimeType: "audio/mpeg",
  byteSize: 2048,
  durationMs: 900,
  sha256: "a".repeat(64),
  voiceProfileVersion: 1,
  takeId: "take_1",
  metadata: {},
};

describe("export format", () => {
  it("uses stable IDs rather than phrase text in filenames", () => {
    expect(outputFileName("Correct Continue 001", "mp3")).toBe("correct-continue-001.mp3");
  });

  it("emits a code-ready TypeScript map", () => {
    const source = buildAudioMap([asset]);
    expect(source).toContain('"correct-continue-001": "/audio/correct-continue/correct-continue-001.mp3"');
    expect(source).toContain("as const");
    const fixtureRoot = mkdtempSync(join(tmpdir(), "voice-foundry-map-"));
    const fixturePath = join(fixtureRoot, "audio-map.ts");
    try {
      writeFileSync(fixturePath, source, "utf8");
      const tscEntry = join(process.cwd(), "node_modules", "typescript", "lib", "tsc.js");
      const compiled = spawnSync(process.execPath, [
        tscEntry, "--ignoreConfig", "--noEmit", "--pretty", "false", "--target", "ES2022", "--module", "ESNext",
        "--moduleResolution", "Bundler", "--skipLibCheck", fixturePath,
      ], { encoding: "utf8" });
      expect(`${compiled.stdout}${compiled.stderr}`).toBe("");
      expect(compiled.status).toBe(0);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("properly quotes CSV text", () => {
    const csv = buildPhrasesCsv([{ ...asset, text: 'Sí, "seguimos".' }]);
    expect(csv).toContain('"Sí, ""seguimos""."');
  });

  it("rejects collisions and unsafe export paths", () => {
    const result = validateExportAssets([
      asset,
      { ...asset, takeId: "take_2", src: "../audio.mp3" },
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "Duplicate asset ID: correct-continue-001",
      "Unsafe export path for correct-continue-001: ../audio.mp3",
    ]));
  });

  it("emits stable checksum lines", () => {
    expect(buildChecksums([asset])).toBe(`${"a".repeat(64)}  ${asset.src}\n`);
  });
});
