"use client";

import { useEffect, useRef, useState } from "react";
import { generateSpeech } from "./api";
import { cloneRecipe, recipeFingerprint } from "./batch";
import styles from "./VoiceLab.module.css";
import type { VoiceRecipe } from "./types";
import { shareOrDownload } from "./zip";

type RecipeEditorProps = {
  recipe: VoiceRecipe;
  onChange: (recipe: VoiceRecipe) => void;
  onNotice: (tone: "success" | "error" | "info", message: string) => void;
};

function RangeField({ label, value, min, max, step, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return <label className={styles.rangeField}><span>{label}<output>{value.toFixed(2)}</output></span><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(event.currentTarget.valueAsNumber)} /></label>;
}

export function RecipeEditor({ recipe, onChange, onNotice }: RecipeEditorProps) {
  const testControllerRef = useRef<AbortController | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [testPhrase, setTestPhrase] = useState("");
  const [testLoading, setTestLoading] = useState(false);
  const [testAudio, setTestAudio] = useState<{ blob: Blob; url: string; fingerprint: string } | null>(null);

  useEffect(() => () => {
    testControllerRef.current?.abort();
  }, []);

  useEffect(() => () => {
    if (testAudio) URL.revokeObjectURL(testAudio.url);
  }, [testAudio]);

  const updateSettings = <Key extends keyof VoiceRecipe["settings"]>(key: Key, value: VoiceRecipe["settings"][Key]) => {
    onChange({ ...recipe, settings: { ...recipe.settings, [key]: value } });
  };

  const generateTest = async () => {
    if (testControllerRef.current) return;
    const text = testPhrase.trim();
    if (!recipe.voiceId.trim()) {
      onNotice("error", "Choose a voice or paste a Voice ID before generating a test.");
      return;
    }
    if (!text) {
      onNotice("error", "Enter a test phrase first.");
      return;
    }
    const snapshot = cloneRecipe(recipe);
    const controller = new AbortController();
    testControllerRef.current = controller;
    setTestLoading(true);
    try {
      const blob = await generateSpeech(text, snapshot, controller.signal);
      if (controller.signal.aborted) return;
      setTestAudio({ blob, url: URL.createObjectURL(blob), fingerprint: recipeFingerprint(snapshot) });
      onNotice("success", "Test phrase generated. Listen before starting the batch.");
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        onNotice("error", error instanceof Error ? error.message : "The test phrase could not be generated.");
      }
    } finally {
      if (!controller.signal.aborted) setTestLoading(false);
      if (testControllerRef.current === controller) testControllerRef.current = null;
    }
  };

  const testIsStale = testAudio !== null && testAudio.fingerprint !== recipeFingerprint(recipe);

  return (
    <section className={styles.section} id="recipe" aria-labelledby="recipe-heading">
      <div className={styles.sectionHeading}><div><span className={styles.step}>02 · Recipe</span><h2 id="recipe-heading">Tune the generation settings</h2></div><span className={styles.warningBadge}>Paid generation</span></div>
      <div className={styles.recipeGrid}>
        <div className={styles.recipeFields}>
          <label className={styles.field}><span>Voice ID</span><input value={recipe.voiceId} spellCheck={false} placeholder="Paste an ElevenLabs Voice ID" onChange={(event) => onChange({ ...recipe, voiceId: event.currentTarget.value.trim() })} /></label>
          <label className={styles.field}><span>Voice name <small>optional label</small></span><input value={recipe.voiceName} placeholder="My voice" onChange={(event) => onChange({ ...recipe, voiceName: event.currentTarget.value })} /></label>
          <label className={styles.field}><span>Model</span><select value={recipe.modelId} onChange={(event) => onChange({ ...recipe, modelId: event.currentTarget.value as VoiceRecipe["modelId"] })}><option value="eleven_multilingual_v2">Multilingual v2</option><option value="eleven_v3">Eleven v3</option><option value="eleven_flash_v2_5">Flash v2.5</option></select></label>
          <label className={styles.field}><span>Output</span><select value={recipe.outputFormat} onChange={(event) => onChange({ ...recipe, outputFormat: event.currentTarget.value as VoiceRecipe["outputFormat"] })}><option value="mp3_44100_128">MP3 · 44.1 kHz · 128 kbps</option><option value="mp3_44100_192">MP3 · 44.1 kHz · 192 kbps</option></select></label>
          <RangeField label="Stability" value={recipe.settings.stability} min={0} max={1} step={0.01} onChange={(value) => updateSettings("stability", value)} />
          <RangeField label="Similarity" value={recipe.settings.similarityBoost} min={0} max={1} step={0.01} onChange={(value) => updateSettings("similarityBoost", value)} />
          <RangeField label="Style" value={recipe.settings.style} min={0} max={1} step={0.01} onChange={(value) => updateSettings("style", value)} />
          <RangeField label="Speed" value={recipe.settings.speed} min={0.7} max={1.2} step={0.01} onChange={(value) => updateSettings("speed", value)} />
          <label className={styles.toggle}><input type="checkbox" checked={recipe.settings.useSpeakerBoost} onChange={(event) => updateSettings("useSpeakerBoost", event.currentTarget.checked)} /><span>Speaker boost</span></label>
          <button className={styles.textButton} type="button" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((value) => !value)}>{advancedOpen ? "Hide" : "Show"} advanced settings</button>
          {advancedOpen ? <div className={styles.advancedFields}>
            <label className={styles.field}><span>Language code <small>optional</small></span><input value={recipe.languageCode} placeholder="en, es, fr…" maxLength={12} onChange={(event) => onChange({ ...recipe, languageCode: event.currentTarget.value.trim().toLocaleLowerCase() })} /></label>
            <label className={styles.field}><span>Seed <small>optional integer</small></span><input type="number" min={0} max={4294967295} step={1} value={recipe.seed ?? ""} placeholder="Random" onChange={(event) => { const value = event.currentTarget.valueAsNumber; onChange({ ...recipe, seed: event.currentTarget.value === "" || !Number.isFinite(value) ? null : Math.trunc(value) }); }} /></label>
          </div> : null}
        </div>

        <div className={styles.testPanel}>
          <span className={styles.miniLabel}>Test first</span>
          <h3>Hear one phrase</h3>
          <p>Each click sends a new paid request to ElevenLabs. Replaying the result is free.</p>
          <label className={styles.field}><span>Test phrase</span><textarea rows={5} value={testPhrase} maxLength={5_000} placeholder="Type one short phrase…" onChange={(event) => setTestPhrase(event.currentTarget.value)} /><small className={styles.counter}>{testPhrase.length.toLocaleString()} / 5,000 characters</small></label>
          <button className={styles.primaryButton} type="button" disabled={testLoading || !recipe.voiceId || !testPhrase.trim()} onClick={() => void generateTest()}>{testLoading ? "Generating…" : "Generate test"}</button>
          {testAudio ? <div className={styles.testResult}><audio controls src={testAudio.url} /><div className={styles.inlineActions}><button type="button" className={styles.secondaryButton} onClick={() => void shareOrDownload(testAudio.blob, "voice-test.mp3", "Voice Lab test")}>Share or download</button>{testIsStale ? <span className={styles.warningText}>Made with previous settings</span> : null}</div></div> : null}
        </div>
      </div>
    </section>
  );
}
