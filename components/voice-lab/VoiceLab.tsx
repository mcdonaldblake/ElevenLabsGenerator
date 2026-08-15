"use client";

import { useEffect, useState } from "react";
import { PhraseWorkbench } from "./PhraseWorkbench";
import { RecipeEditor } from "./RecipeEditor";
import styles from "./VoiceLab.module.css";
import type { AccountVoice, Notice, VoiceRecipe } from "./types";
import { DEFAULT_RECIPE } from "./types";
import { VoiceBrowser } from "./VoiceBrowser";

export function VoiceLab() {
  const [recipe, setRecipe] = useState<VoiceRecipe>(DEFAULT_RECIPE);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (!notice) return undefined;
    const timeout = window.setTimeout(() => setNotice(null), 5_000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const notify = (tone: Notice["tone"], message: string) => setNotice({ tone, message });
  const selectVoice = (voice: AccountVoice) => {
    setRecipe((current) => ({ ...current, voiceId: voice.id, voiceName: voice.name }));
    document.getElementById("recipe")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <main className={styles.page}>
      <a className={styles.skipLink} href="#voices">Skip to Voice Lab</a>
      <header className={styles.hero}>
        <div className={styles.brand}><span className={styles.brandMark}>V</span><span><small>ElevenLabs Generator</small><strong>Voice Lab</strong></span></div>
        <div className={styles.heroCopy}><p className={styles.eyebrow}>One page. Any project.</p><h1>Find the voice, tune the sound, make the files.</h1><p>Browse ElevenLabs voices, test a recipe, then turn pasted lines or a batch file into downloadable MP3s. Everything you create stays only in this tab.</p></div>
        <nav className={styles.quickNav} aria-label="Voice Lab sections"><a href="#voices">1. Browse</a><a href="#recipe">2. Tune</a><a href="#phrases">3. Generate</a></nav>
      </header>
      {notice ? <div className={`${styles.notice} ${styles[`notice${notice.tone[0]?.toLocaleUpperCase()}${notice.tone.slice(1)}`]}`} role="status"><span>{notice.message}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice(null)}>×</button></div> : null}
      <div className={styles.content}>
        <VoiceBrowser selectedVoiceId={recipe.voiceId} onSelect={selectVoice} onNotice={notify} />
        <RecipeEditor recipe={recipe} onChange={setRecipe} onNotice={notify} />
        <PhraseWorkbench recipe={recipe} onNotice={notify} />
      </div>
      <footer className={styles.footer}><p><strong>Voice Lab</strong> · Temporary browser workspace</p><p>Your ElevenLabs key remains on the server. Audio and imported text are discarded when this tab closes.</p></footer>
    </main>
  );
}
