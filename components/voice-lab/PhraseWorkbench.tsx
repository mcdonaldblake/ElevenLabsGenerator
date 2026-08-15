"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { generateSpeech } from "./api";
import { cloneRecipe, recipeFingerprint, runWithConcurrency } from "./batch";
import { duplicateKey, parseMultiline, parsePhraseFile } from "./import";
import styles from "./VoiceLab.module.css";
import type { ImportCandidate, ImportPreview, PhraseJob, VoiceRecipe } from "./types";
import { audioFilename, buildAudioExport, shareOrDownload } from "./zip";

const CHUNK_SIZE = 100;
const PAGE_SIZE = 100;
const CONCURRENCY = 2;

type PhraseWorkbenchProps = {
  recipe: VoiceRecipe;
  onNotice: (tone: "success" | "error" | "info", message: string) => void;
};

function newKey(index: number): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`;
}

function candidatesToJobs(rows: ImportCandidate[], startingSequence: number): PhraseJob[] {
  return rows.filter((row) => row.status === "valid").map((row, index) => ({
    key: newKey(index),
    sequence: startingSequence + index,
    id: row.id,
    filename: row.filename,
    text: row.text,
    status: "pending",
    error: null,
    audio: null,
    audioUrl: null,
    recipeFingerprint: null,
    recipeSnapshot: null,
  }));
}

export function PhraseWorkbench({ recipe, onNotice }: PhraseWorkbenchProps) {
  const jobsRef = useRef<PhraseJob[]>([]);
  const activeControllersRef = useRef(new Set<AbortController>());
  const generationRef = useRef<{ canceled: boolean } | null>(null);
  const nextSequenceRef = useRef(1);
  const mountedRef = useRef(true);
  const [jobs, setJobs] = useState<PhraseJob[]>([]);
  const [textInput, setTextInput] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [generationRunning, setGenerationRunning] = useState(false);
  const [activeRequests, setActiveRequests] = useState(0);
  const [lastChunkIds, setLastChunkIds] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const [queuePage, setQueuePage] = useState(0);

  const currentFingerprint = recipeFingerprint(recipe);
  const counts = useMemo(() => jobs.reduce((result, job) => {
    result[job.status] += 1;
    return result;
  }, { pending: 0, generating: 0, ready: 0, failed: 0 }), [jobs]);
  const totalCharacters = useMemo(() => jobs.reduce((sum, job) => sum + job.text.length, 0), [jobs]);
  const nextChunk = useMemo(() => jobs.filter((job) => job.status === "pending").slice(0, CHUNK_SIZE), [jobs]);
  const nextChunkCharacters = useMemo(() => nextChunk.reduce((sum, job) => sum + job.text.length, 0), [nextChunk]);
  const pageCount = Math.max(1, Math.ceil(jobs.length / PAGE_SIZE));
  const safeQueuePage = Math.min(queuePage, pageCount - 1);
  const visibleJobs = jobs.slice(safeQueuePage * PAGE_SIZE, (safeQueuePage + 1) * PAGE_SIZE);
  const lastChunkJobs = useMemo(() => {
    const ids = new Set(lastChunkIds);
    return jobs.filter((job) => ids.has(job.key) && job.status === "ready");
  }, [jobs, lastChunkIds]);

  const replaceJobs = (updater: (current: PhraseJob[]) => PhraseJob[]) => {
    const next = updater(jobsRef.current);
    jobsRef.current = next;
    setJobs(next);
  };

  useEffect(() => {
    const activeControllers = activeControllersRef.current;
    mountedRef.current = true;
    generationRef.current = null;
    return () => {
      mountedRef.current = false;
      generationRef.current = { canceled: true };
      for (const controller of activeControllers) controller.abort();
      activeControllers.clear();
      for (const job of jobsRef.current) if (job.audioUrl) URL.revokeObjectURL(job.audioUrl);
    };
  }, []);

  const existingTexts = () => jobsRef.current.map((job) => job.text);

  const previewLines = () => {
    setImportError(null);
    try {
      setPreview(parseMultiline(textInput, existingTexts()));
    } catch (error) {
      setPreview(null);
      setImportError(error instanceof Error ? error.message : "Those lines could not be read.");
    }
  };

  const previewFile = async (file: File | undefined) => {
    if (!file) return;
    setImportLoading(true);
    setImportError(null);
    setPreview(null);
    try {
      setPreview(await parsePhraseFile(file, existingTexts()));
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "That file could not be read.");
    } finally {
      setImportLoading(false);
    }
  };

  const addPreview = () => {
    if (!preview) return;
    const seen = new Set(existingTexts().map(duplicateKey));
    const rows = preview.rows.filter((row) => {
      if (row.status !== "valid") return false;
      const key = duplicateKey(row.text);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const additions = candidatesToJobs(rows, nextSequenceRef.current);
    if (additions.length === 0) {
      onNotice("info", "There are no valid new phrases to add.");
      return;
    }
    nextSequenceRef.current += additions.length;
    replaceJobs((current) => [...current, ...additions]);
    if (preview.fileName === "Pasted phrases") setTextInput("");
    setPreview(null);
    onNotice("success", `${additions.length.toLocaleString()} phrases added to this tab.`);
  };

  const patchJob = (key: string, updater: (job: PhraseJob) => PhraseJob) => {
    if (!mountedRef.current) return;
    replaceJobs((current) => current.map((job) => {
      if (job.key !== key) return job;
      const next = updater(job);
      if (job.audioUrl && job.audioUrl !== next.audioUrl) URL.revokeObjectURL(job.audioUrl);
      return next;
    }));
  };

  const generateIds = async (ids: string[], trackAsChunk = false) => {
    if (generationRef.current || ids.length === 0) return;
    if (!recipe.voiceId.trim()) {
      onNotice("error", "Choose a voice before generating audio.");
      return;
    }
    const currentRecipeSnapshot = cloneRecipe(recipe);
    const session = { canceled: false };
    generationRef.current = session;
    setGenerationRunning(true);
    if (trackAsChunk) setLastChunkIds(ids);
    try {
      await runWithConcurrency(ids, CONCURRENCY, async (key) => {
        if (session.canceled) return;
        const currentJob = jobsRef.current.find((job) => job.key === key);
        if (!currentJob) return;
        const snapshot = currentJob.status === "failed" && currentJob.recipeSnapshot !== null
          ? cloneRecipe(currentJob.recipeSnapshot)
          : currentRecipeSnapshot;
        const fingerprint = recipeFingerprint(snapshot);
        patchJob(key, (job) => ({ ...job, status: "generating", error: null, recipeFingerprint: fingerprint, recipeSnapshot: snapshot }));
        const controller = new AbortController();
        activeControllersRef.current.add(controller);
        if (mountedRef.current) setActiveRequests((value) => value + 1);
        try {
          const audio = await generateSpeech(currentJob.text, snapshot, controller.signal);
          if (!controller.signal.aborted) patchJob(key, (job) => ({ ...job, status: "ready", error: null, audio, audioUrl: URL.createObjectURL(audio), recipeFingerprint: fingerprint, recipeSnapshot: snapshot }));
        } catch (error) {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            patchJob(key, (job) => ({ ...job, status: "failed", error: error instanceof Error ? error.message : "Generation failed." }));
          }
        } finally {
          activeControllersRef.current.delete(controller);
          if (mountedRef.current) setActiveRequests((value) => Math.max(0, value - 1));
        }
      }, () => session.canceled);
      if (mountedRef.current) {
        const readyCount = ids.filter((key) => jobsRef.current.find((job) => job.key === key)?.status === "ready").length;
        onNotice(session.canceled ? "info" : "success", session.canceled ? "Remaining phrases were left pending." : `${readyCount} of ${ids.length} clips generated.`);
      }
    } finally {
      if (mountedRef.current) setGenerationRunning(false);
      if (generationRef.current === session) generationRef.current = null;
    }
  };

  const generateNextChunk = () => {
    void generateIds(nextChunk.map((job) => job.key), true);
  };

  const removeJob = (key: string) => {
    const job = jobsRef.current.find((item) => item.key === key);
    if (job?.audioUrl) URL.revokeObjectURL(job.audioUrl);
    replaceJobs((current) => current.filter((item) => item.key !== key));
    setLastChunkIds((current) => current.filter((item) => item !== key));
  };

  const clearReady = () => {
    const readyKeys = new Set(jobsRef.current.filter((job) => job.status === "ready").map((job) => job.key));
    for (const job of jobsRef.current) if (readyKeys.has(job.key) && job.audioUrl) URL.revokeObjectURL(job.audioUrl);
    replaceJobs((current) => current.filter((job) => !readyKeys.has(job.key)));
    setLastChunkIds((current) => current.filter((key) => !readyKeys.has(key)));
    onNotice("info", "Generated clips were cleared from this tab.");
  };

  const exportChunk = async () => {
    if (lastChunkJobs.length === 0) return;
    setExporting(true);
    try {
      const zip = await buildAudioExport(lastChunkJobs);
      const result = await shareOrDownload(zip, `voice-lab-${new Date().toISOString().slice(0, 10)}.zip`, "Voice Lab batch");
      if (result === "canceled") onNotice("info", "Sharing was canceled. Your clips are still available in this tab.");
      else onNotice("success", result === "shared" ? "Batch opened in the iPhone share sheet." : "Batch ZIP downloaded.");
    } catch (error) {
      onNotice("error", error instanceof Error ? error.message : "The batch ZIP could not be created.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className={styles.section} id="phrases" aria-labelledby="phrases-heading">
      <div className={styles.sectionHeading}><div><span className={styles.step}>03 · Phrases</span><h2 id="phrases-heading">Import, generate, and download</h2></div><span className={styles.neutralBadge}>Tab memory only</span></div>
      <div className={styles.importGrid}>
        <div>
          <label className={styles.field}><span>Paste phrases <small>one clip per nonempty line</small></span><textarea rows={8} value={textInput} placeholder={"Welcome to the app.\nTap continue to begin.\nYour changes have been saved."} onChange={(event) => setTextInput(event.currentTarget.value)} /></label>
          <button type="button" className={styles.secondaryButton} disabled={!textInput.trim()} onClick={previewLines}>Preview lines</button>
        </div>
        <div className={styles.dropPanel}>
          <span className={styles.miniLabel}>Batch file</span><h3>Import TXT, CSV, TSV, or JSON</h3><p>Use a required <code>text</code> or <code>phrase</code> field. <code>id</code> and <code>filename</code> are optional.</p>
          <label className={styles.fileButton}><input type="file" accept=".txt,.csv,.tsv,.json,text/plain,text/csv,application/json" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void previewFile(file); }} /><span>{importLoading ? "Reading file…" : "Choose a file"}</span></label>
          <small>Maximum 25 MB and 100,000 rows. Files stay in this browser.</small>
        </div>
      </div>
      {importError ? <div className={styles.inlineError}><p>{importError}</p></div> : null}
      {preview ? <div className={styles.previewPanel}>
        <div className={styles.previewSummary}><div><span className={styles.miniLabel}>Import preview</span><h3>{preview.fileName}</h3></div><div className={styles.summaryBadges}><span className={styles.successBadge}>{preview.validRows.toLocaleString()} valid</span>{preview.duplicateRows ? <span className={styles.warningBadge}>{preview.duplicateRows.toLocaleString()} duplicate</span> : null}{preview.invalidRows ? <span className={styles.errorBadge}>{preview.invalidRows.toLocaleString()} invalid</span> : null}</div></div>
        <div className={styles.previewTable} role="table" aria-label="Import preview"><div className={styles.previewHeader} role="row"><span>Row</span><span>ID / filename</span><span>Text</span><span>Status</span></div>{preview.rows.slice(0, 12).map((row) => <div className={styles.previewRow} role="row" key={row.sourceRow}><span>{row.sourceRow}</span><span>{row.filename || row.id || "—"}</span><span>{row.text || "Empty"}</span><span className={row.status === "valid" ? styles.goodText : row.status === "duplicate" ? styles.warningText : styles.errorText}>{row.status}{row.issue ? ` · ${row.issue}` : ""}</span></div>)}</div>
        {preview.rows.length > 12 ? <p className={styles.previewNote}>Showing 12 of {preview.rows.length.toLocaleString()} rows.</p> : null}
        <div className={styles.inlineActions}><button type="button" className={styles.primaryButton} disabled={preview.validRows === 0} onClick={addPreview}>Add {preview.validRows.toLocaleString()} valid phrases</button><button type="button" className={styles.textButton} onClick={() => setPreview(null)}>Cancel</button></div>
      </div> : null}

      <div className={styles.queueHeader}>
        <div><span className={styles.miniLabel}>Current tab</span><h3>{jobs.length.toLocaleString()} phrases</h3><div className={styles.queueCounts}><span>{totalCharacters.toLocaleString()} total characters</span><span>{counts.pending} pending</span><span>{counts.generating} generating</span><span>{counts.ready} ready</span>{counts.failed ? <span className={styles.errorText}>{counts.failed} failed</span> : null}</div></div>
        <div className={styles.queueActions}>
          {generationRunning ? <button type="button" className={styles.secondaryButton} onClick={() => { if (generationRef.current) generationRef.current.canceled = true; }}>Cancel remaining</button> : <button type="button" className={styles.primaryButton} disabled={!recipe.voiceId || counts.pending === 0} onClick={generateNextChunk}>Generate next {Math.min(CHUNK_SIZE, counts.pending)}</button>}
          <button type="button" className={styles.secondaryButton} disabled={exporting || lastChunkJobs.length === 0} onClick={() => void exportChunk()}>{exporting ? "Building ZIP…" : `Share / download last chunk (${lastChunkJobs.length})`}</button>
          <button type="button" className={styles.textButton} disabled={generationRunning || counts.ready === 0} onClick={clearReady}>Clear ready clips</button>
        </div>
      </div>
      {counts.pending > 0 || counts.failed > 0 ? <div className={styles.paidWarning}><strong>Paid ElevenLabs generation</strong>{counts.pending > 0 ? <span>The next chunk will send {nextChunk.length.toLocaleString()} paid {nextChunk.length === 1 ? "request" : "requests"} totaling {nextChunkCharacters.toLocaleString()} characters. Replaying downloaded audio is free.</span> : null}{counts.failed > 0 ? <span>Every failed-clip retry is another paid request and could double-charge if the earlier response was lost. Retries use the clip’s original recipe.</span> : null}</div> : null}
      {generationRunning ? <div className={styles.progress} role="status"><span style={{ width: `${Math.round(((lastChunkIds.length - lastChunkIds.filter((key) => jobs.find((job) => job.key === key)?.status === "pending").length) / Math.max(1, lastChunkIds.length)) * 100)}%` }} /><p>{activeRequests} paid requests active · new requests stop after the current pair</p></div> : null}
      {jobs.length === 0 ? <div className={styles.empty}>Add pasted lines or import a file to begin. Nothing is saved when this tab closes.</div> : (
        <div className={styles.jobList}>
          {visibleJobs.map((job, visibleIndex) => {
            const absoluteIndex = safeQueuePage * PAGE_SIZE + visibleIndex;
            const stale = job.status === "ready" && job.recipeFingerprint !== currentFingerprint;
            return <article className={styles.jobRow} key={job.key}>
              <div className={styles.jobNumber}>{String(job.sequence).padStart(3, "0")}</div>
              <div className={styles.jobText}><h3>{job.text}</h3><p>{job.filename || job.id || audioFilename(job)} · {job.text.length.toLocaleString()} characters</p>{job.error ? <p className={styles.fieldError}>{job.error}</p> : null}{stale ? <p className={styles.warningText}>Made with previous settings</p> : null}</div>
              <div className={styles.jobStatus}><span className={job.status === "ready" ? styles.successBadge : job.status === "failed" ? styles.errorBadge : styles.neutralBadge}>{job.status}</span></div>
              <div className={styles.jobAudio}>{job.audioUrl ? <audio controls preload="metadata" src={job.audioUrl} /> : null}</div>
              <div className={styles.jobActions}>
                {job.status === "failed" ? <button type="button" className={styles.secondaryButton} disabled={generationRunning} aria-label="Paid retry using original recipe" title="Paid retry; a lost earlier response could cause a double charge" onClick={() => void generateIds([job.key])}>Paid retry</button> : null}
                {job.status === "pending" ? <button type="button" className={styles.secondaryButton} disabled={generationRunning || !recipe.voiceId} onClick={() => void generateIds([job.key])}>Generate</button> : null}
                {job.audio ? <button type="button" className={styles.secondaryButton} onClick={() => void shareOrDownload(job.audio as Blob, audioFilename(job), job.text)}>Share / download</button> : null}
                <button type="button" className={styles.iconButton} aria-label={`Remove phrase ${absoluteIndex + 1}`} disabled={job.status === "generating"} onClick={() => removeJob(job.key)}>Remove</button>
              </div>
            </article>;
          })}
        </div>
      )}
      {pageCount > 1 ? <div className={styles.pagination}><button className={styles.secondaryButton} type="button" disabled={safeQueuePage === 0} onClick={() => setQueuePage(Math.max(0, safeQueuePage - 1))}>← Previous 100</button><span>Page {safeQueuePage + 1} of {pageCount}</span><button className={styles.secondaryButton} type="button" disabled={safeQueuePage + 1 >= pageCount} onClick={() => setQueuePage(safeQueuePage + 1)}>Next 100 →</button></div> : null}
    </section>
  );
}
