import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Headphones,
  Keyboard,
  Pause,
  Play,
  Redo2,
  Repeat2,
  RotateCcw,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, isServerUnavailable } from "../lib/api";
import { formatDuration, formatNumber, percent } from "../lib/format";
import { mockReview } from "../lib/mock-data";
import type { PhraseDecision, ReviewItem, ReviewPage } from "../types";
import { Badge, Button, Card, EmptyState, PageHeader, ProgressBar, cx } from "../components/ui";

type UndoRecord = {
  page: number;
  index: number;
  phraseId: string;
  previous: PhraseDecision;
  next: PhraseDecision;
  takeId: string | null;
  previousPrimaryTakeId: string | null;
  previousTakes: ReviewItem["takes"];
};

type ReviewPageProps = {
  projectId: string;
  isDemoMode: boolean;
  onServerUnavailable: () => void;
  notify: (tone: "success" | "error" | "info", title: string, detail: string) => void;
};

function shouldAutoAdvance(): boolean {
  try {
    const stored = localStorage.getItem("voice-foundry-preferences-v1");
    if (!stored) return true;
    const parsed = JSON.parse(stored) as { autoAdvance?: unknown };
    return typeof parsed.autoAdvance === "boolean" ? parsed.autoAdvance : true;
  } catch {
    return true;
  }
}

export function ReviewPage({ projectId, isDemoMode, onServerUnavailable, notify }: ReviewPageProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const checkingAudioAccessRef = useRef(false);
  const decidingRef = useRef(false);
  const pageLandingRef = useRef<"first" | "last">("first");
  const [queue, setQueue] = useState<ReviewPage>(() => isDemoMode ? mockReview : { items: [], page: 1, pageSize: 100, total: 0, counts: { pending: 0, kept: 0, discarded: 0 } });
  const [reviewPage, setReviewPage] = useState(1);
  const [index, setIndex] = useState(0);
  const [takeIndex, setTakeIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [undoStack, setUndoStack] = useState<UndoRecord[]>([]);
  const current = queue.items[index];
  const currentTake = current?.takes[takeIndex] ?? current?.takes[0];

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (isDemoMode) return;
      try {
        const next = await api.review(projectId, undefined, reviewPage, 100);
        if (!cancelled) {
          const audioItems = next.items.filter((item) => item.takes.length > 0);
          const nextIndex = pageLandingRef.current === "last" ? Math.max(audioItems.length - 1, 0) : 0;
          const nextItem = audioItems[nextIndex];
          const primaryIndex = nextItem?.takes.findIndex((take) => take.isPrimary) ?? -1;
          setQueue({ ...next, items: audioItems });
          setIndex(nextIndex);
          setTakeIndex(primaryIndex >= 0 ? primaryIndex : 0);
          pageLandingRef.current = "first";
        }
      } catch (error) {
        if (!cancelled) {
          if (isServerUnavailable(error)) onServerUnavailable();
          else notify("error", "Audio review could not load", error instanceof Error ? error.message : "Please try again.");
        }
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [isDemoMode, notify, onServerUnavailable, projectId, reviewPage]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    setIsPlaying(false);
    setAudioProgress(0);
    setAudioDuration(currentTake?.durationMs ? currentTake.durationMs / 1_000 : 0);
    if (currentTake && !isDemoMode) {
      audio.src = api.audioUrl(currentTake.id);
      audio.load();
    } else {
      audio.removeAttribute("src");
      audio.load();
    }
  }, [currentTake?.id, currentTake?.durationMs, isDemoMode]);

  const handleAudioError = useCallback(async () => {
    if (isDemoMode || checkingAudioAccessRef.current) return;
    checkingAudioAccessRef.current = true;
    setIsPlaying(false);
    try {
      const access = await api.recheckAccess();
      if (!access.requiresPairing) {
        notify("error", "Audio could not play", "Confirm the Mac still has this take, then try again.");
      }
    } catch (error) {
      if (isServerUnavailable(error)) onServerUnavailable();
      else notify("error", "Audio access could not be checked", error instanceof Error ? error.message : "Please try again.");
    } finally {
      checkingAudioAccessRef.current = false;
    }
  }, [isDemoMode, notify, onServerUnavailable]);

  const move = useCallback((direction: number) => {
    setIndex((currentIndex) => {
      if (direction > 0 && currentIndex >= queue.items.length - 1 && reviewPage * queue.pageSize < queue.total) {
        pageLandingRef.current = "first";
        setReviewPage((value) => value + 1);
        return currentIndex;
      }
      if (direction < 0 && currentIndex === 0 && reviewPage > 1) {
        pageLandingRef.current = "last";
        setReviewPage((value) => value - 1);
        return currentIndex;
      }
      const next = Math.min(Math.max(0, currentIndex + direction), Math.max(queue.items.length - 1, 0));
      if (next !== currentIndex) {
        const primaryIndex = queue.items[next]?.takes.findIndex((take) => take.isPrimary) ?? -1;
        setTakeIndex(primaryIndex >= 0 ? primaryIndex : 0);
      }
      return next;
    });
  }, [queue.items.length, queue.pageSize, queue.total, reviewPage]);

  const togglePlayback = useCallback(async () => {
    const audio = audioRef.current;
    if (!currentTake) return;
    if (isDemoMode) {
      setIsPlaying((playing) => !playing);
      return;
    }
    if (!audio) return;
    if (audio.paused) {
      try { await audio.play(); } catch { await handleAudioError(); }
    } else {
      audio.pause();
    }
  }, [currentTake, handleAudioError, isDemoMode]);

  const updateCurrentDecision = useCallback((nextDecision: PhraseDecision, recordUndo = true) => {
    if (!current) return;
    const previous = current.phrase.decision;
    setQueue((existing) => ({
      ...existing,
      items: existing.items.map((item, itemIndex) => itemIndex === index ? {
        ...item,
        phrase: {
          ...item.phrase,
          decision: nextDecision,
          primaryTakeId: nextDecision === "kept" ? (currentTake?.id ?? item.phrase.primaryTakeId) : null,
        },
        takes: item.takes.map((take) => ({
          ...take,
          decision: take.id === currentTake?.id ? nextDecision : take.decision,
          isPrimary: nextDecision === "kept" && take.id === currentTake?.id,
        })),
      } : item),
    }));
    if (recordUndo) setUndoStack((stack) => [...stack.slice(-19), {
      page: reviewPage,
      index,
      phraseId: current.phrase.id,
      previous,
      next: nextDecision,
      takeId: currentTake?.id ?? null,
      previousPrimaryTakeId: current.phrase.primaryTakeId,
      previousTakes: current.takes.map((take) => ({ ...take })),
    }]);
  }, [current, currentTake?.id, index, reviewPage]);

  const decide = useCallback(async (nextDecision: Exclude<PhraseDecision, "pending">) => {
    if (!current || decidingRef.current) return;
    decidingRef.current = true;
    let advanceScheduled = false;
    setSaving(true);
    updateCurrentDecision(nextDecision);
    try {
      if (!isDemoMode) {
        if (currentTake) await api.reviewAudio(currentTake.id, nextDecision);
        else await api.reviewPhrase(current.phrase.id, nextDecision);
      }
      if (shouldAutoAdvance()) {
        advanceScheduled = true;
        window.setTimeout(() => {
          move(1);
          decidingRef.current = false;
        }, 110);
      } else {
        decidingRef.current = false;
      }
    } catch (error) {
      updateCurrentDecision(current.phrase.decision, false);
      notify("error", "Decision did not save", error instanceof Error ? error.message : "Please try again.");
    } finally {
      if (!advanceScheduled) decidingRef.current = false;
      setSaving(false);
    }
  }, [current, currentTake, isDemoMode, move, notify, updateCurrentDecision]);

  const regenerate = useCallback(async () => {
    if (!current) return;
    setRegenerating(true);
    try {
      if (!isDemoMode) {
        const regenerationBatch = await api.regeneratePhrase(current.phrase.id);
        let latest = regenerationBatch;
        for (let attempt = 0; attempt < 40 && ["queued", "running", "retry_wait"].includes(latest.status); attempt += 1) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 1_000));
          latest = await api.batch(latest.id);
        }
        if (latest.status === "succeeded" || latest.status === "partial") {
          const refreshed = await api.review(projectId, undefined, reviewPage, 100);
          setQueue({ ...refreshed, items: refreshed.items.filter((item) => item.takes.length > 0) });
        }
      }
      notify("success", "One new take queued", "This phrase was added to targeted regeneration; existing takes remain available.");
    } catch (error) {
      notify("error", "Regeneration did not queue", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setRegenerating(false);
    }
  }, [current, isDemoMode, notify, projectId, reviewPage]);

  const undo = useCallback(async () => {
    const last = undoStack.at(-1);
    if (!last) return;
    setUndoStack((stack) => stack.slice(0, -1));
    if (reviewPage !== last.page) {
      pageLandingRef.current = "first";
      setReviewPage(last.page);
    }
    setIndex(last.index);
    setQueue((existing) => ({
      ...existing,
      items: existing.items.map((item) => item.phrase.id === last.phraseId ? {
        ...item,
        phrase: { ...item.phrase, decision: last.previous, primaryTakeId: last.previousPrimaryTakeId },
        takes: last.previousTakes,
      } : item),
    }));
    try {
      if (!isDemoMode) {
        if (last.previous === "kept" && last.previousPrimaryTakeId) {
          await api.reviewAudio(last.previousPrimaryTakeId, "kept");
        } else {
          if (last.takeId) await api.reviewAudio(last.takeId, last.previous);
          await api.reviewPhrase(last.phraseId, last.previous);
        }
      }
      notify("info", "Last decision undone", "The phrase is back in its previous state.");
    } catch (error) {
      notify("error", "Undo did not save", error instanceof Error ? error.message : "Please try again.");
    }
  }, [isDemoMode, notify, reviewPage, undoStack]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      const key = event.key.toLocaleLowerCase("en-US");
      if (key === " " || key === "k" || key === "x" || key === "r" || key === "j" || key === "arrowright" || key === "arrowleft" || key === "u" || key === "l") event.preventDefault();
      if (key === " ") void togglePlayback();
      else if (key === "k") void decide("kept");
      else if (key === "x") void decide("discarded");
      else if (key === "r") void regenerate();
      else if (key === "j" || key === "arrowright") move(1);
      else if (key === "arrowleft") move(-1);
      else if (key === "u") void undo();
      else if (key === "l") setLoop((currentLoop) => !currentLoop);
      else if (/^[1-5]$/.test(key)) {
        const requestedTake = Number(key) - 1;
        if (current?.takes[requestedTake]) setTakeIndex(requestedTake);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [current?.takes, decide, move, regenerate, togglePlayback, undo]);

  const decisionsMade = queue.items.filter((item) => item.phrase.decision !== "pending").length;
  const reviewPercent = percent(decisionsMade, queue.items.length);

  return (
    <div className="page-stack review-page">
      <PageHeader
        eyebrow="Step 4 of 4"
        title="Audio review"
        description="Listen once, decide fast, and move on. Every keyboard decision is saved immediately."
        actions={<Badge tone="info"><Keyboard size={14} /> Keyboard-first</Badge>}
      />

      {current && currentTake ? (
        <>
          <div className="review-progress-header">
            <span><strong>Clip {(reviewPage - 1) * queue.pageSize + index + 1}</strong> of {formatNumber(queue.total)}</span>
            <ProgressBar value={reviewPercent} label="Audio review progress" />
            <span>{reviewPercent}% decided</span>
          </div>

          <Card className="review-stage">
            <div className="review-stage__topline">
              <div className="review-tags"><Badge tone={current.phrase.decision === "kept" ? "success" : current.phrase.decision === "discarded" ? "danger" : "warning"}>{current.phrase.decision}</Badge>{current.phrase.groupCode ? <Badge>{current.phrase.groupCode}</Badge> : null}{current.phrase.tone ? <Badge>{current.phrase.tone}</Badge> : null}</div>
              <span>{current.phrase.externalId}</span>
            </div>
            <div className="review-phrase">
              <p lang="es">“{current.phrase.displayText}”</p>
              {current.phrase.englishMeaning ? <span>{current.phrase.englishMeaning}</span> : null}
            </div>

            <div className="audio-player">
              <button className="play-button" type="button" onClick={() => void togglePlayback()} aria-label={isPlaying ? "Pause current take" : "Play current take"}>
                {isPlaying ? <Pause size={25} fill="currentColor" /> : <Play size={25} fill="currentColor" />}
              </button>
              <div className="waveform" aria-hidden="true">
                {Array.from({ length: 48 }, (_, bar) => <i key={bar} className={bar / 48 <= audioProgress ? "is-played" : undefined} style={{ height: `${22 + ((bar * 17) % 41)}%` }} />)}
                <input type="range" min={0} max={Math.max(audioDuration, 1)} step={0.01} value={Math.min(audioProgress * Math.max(audioDuration, 1), Math.max(audioDuration, 1))} onChange={(event) => { const audio = audioRef.current; if (audio) audio.currentTime = event.currentTarget.valueAsNumber; }} aria-label="Audio position" />
              </div>
              <span className="audio-time">{formatDuration((audioDuration || currentTake.durationMs || 0) * (isDemoMode ? audioProgress * 1_000 : 1))}</span>
              <button className={cx("loop-button", loop && "is-active")} type="button" onClick={() => setLoop((value) => !value)} aria-pressed={loop} aria-label="Loop current take"><Repeat2 size={18} /></button>
            </div>

            <audio
              ref={audioRef}
              loop={loop}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onTimeUpdate={(event) => {
                const audio = event.currentTarget;
                setAudioDuration(Number.isFinite(audio.duration) ? audio.duration : currentTake.durationMs ? currentTake.durationMs / 1_000 : 0);
                setAudioProgress(audio.duration > 0 ? audio.currentTime / audio.duration : 0);
              }}
              onEnded={() => setIsPlaying(false)}
              onError={() => { void handleAudioError(); }}
            />

            <div className="take-selector" aria-label="Audio takes">
              {current.takes.map((take, nextTakeIndex) => (
                <button type="button" className={cx(nextTakeIndex === takeIndex && "is-active")} onClick={() => setTakeIndex(nextTakeIndex)} key={take.id}>
                  <span>Take {take.takeNumber}</span><small>{formatDuration(take.durationMs)} · v{take.voiceProfileVersion}</small>{take.isPrimary ? <CheckCircle2 size={15} /> : null}
                </button>
              ))}
            </div>

            <div className="decision-grid">
              <Button className="decision-button decision-button--keep" loading={saving} onClick={() => void decide("kept")}><Check size={22} /> <span><strong>Keep</strong><small>K</small></span></Button>
              <Button className="decision-button decision-button--discard" variant="danger" loading={saving} onClick={() => void decide("discarded")}><X size={22} /> <span><strong>Discard</strong><small>X</small></span></Button>
              <Button className="decision-button decision-button--regen" variant="secondary" loading={regenerating} onClick={() => void regenerate()}><Redo2 size={20} /> <span><strong>Regenerate</strong><small>R</small></span></Button>
            </div>

            <div className="review-navigation">
              <Button variant="ghost" disabled={index === 0 && reviewPage === 1} onClick={() => move(-1)}><ArrowLeft size={17} /> Previous</Button>
              <Button variant="ghost" disabled={undoStack.length === 0} onClick={() => void undo()}><RotateCcw size={16} /> Undo <kbd>U</kbd></Button>
              <Button variant="ghost" disabled={index >= queue.items.length - 1 && reviewPage * queue.pageSize >= queue.total} onClick={() => move(1)}>Next <ArrowRight size={17} /></Button>
            </div>
          </Card>

          <Card className="shortcut-card">
            <span><Keyboard size={18} /> <strong>Shortcuts</strong></span>
            <Shortcut keys="Space" label="Play / pause" /><Shortcut keys="1–5" label="Select take" /><Shortcut keys="K" label="Keep" /><Shortcut keys="X" label="Discard" /><Shortcut keys="R" label="Regenerate" /><Shortcut keys="J / →" label="Next" /><Shortcut keys="←" label="Previous" /><Shortcut keys="U" label="Undo" /><Shortcut keys="L" label="Loop" />
          </Card>
          {queue.total > queue.pageSize ? <Card className="review-page-controls"><Button variant="secondary" disabled={reviewPage <= 1} onClick={() => setReviewPage((value) => Math.max(1, value - 1))}><ArrowLeft size={16} /> Previous 100 clips</Button><span>Page {reviewPage} of {Math.ceil(queue.total / queue.pageSize)}</span><Button variant="secondary" disabled={reviewPage >= Math.ceil(queue.total / queue.pageSize)} onClick={() => setReviewPage((value) => value + 1)}>Next 100 clips <ArrowRight size={16} /></Button></Card> : null}
        </>
      ) : (
        <Card><EmptyState icon={<Headphones />} title="No clips are ready for review" description="Finish a calibration or full phrase batch, then return here." /></Card>
      )}
    </div>
  );
}

function Shortcut({ keys, label }: { keys: string; label: string }) {
  return <span className="shortcut"><kbd>{keys}</kbd><small>{label}</small></span>;
}
