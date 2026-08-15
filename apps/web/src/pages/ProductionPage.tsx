import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Check,
  CircleStop,
  Clock3,
  Factory,
  Gauge,
  Headphones,
  Play,
  RefreshCw,
  ShieldCheck,
  Volume2,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, isServerUnavailable } from "../lib/api";
import { formatNumber, percent } from "../lib/format";
import { mockActiveBatch, mockPreflight, mockVoiceProfiles } from "../lib/mock-data";
import type { AppPage, ProductionMode, ProductionPreflight, TtsBatch, VoiceProfile } from "../types";
import { Badge, Button, Card, EmptyState, Field, PageHeader, ProgressBar, cx } from "../components/ui";

const MODE_DETAILS: Record<Exclude<ProductionMode, "regeneration">, { title: string; eyebrow: string; description: string; icon: React.ReactNode }> = {
  calibration: {
    title: "Calibration sample",
    eyebrow: "Start small",
    description: "Make up to 20 representative clips and listen before committing the whole phrase batch.",
    icon: <Gauge />,
  },
  first_pass: {
    title: "Full phrase batch",
    eyebrow: "One take each",
    description: "Generate one take for every pending or kept phrase that does not already have this exact audio recipe.",
    icon: <Factory />,
  },
};

type ProductionPageProps = {
  projectId: string;
  isDemoMode: boolean;
  onServerUnavailable: () => void;
  onNavigate: (page: AppPage) => void;
  notify: (tone: "success" | "error" | "info", title: string, detail: string) => void;
};

export function ProductionPage({ projectId, isDemoMode, onServerUnavailable, onNavigate, notify }: ProductionPageProps) {
  const [profiles, setProfiles] = useState<VoiceProfile[]>(() => isDemoMode ? mockVoiceProfiles : []);
  const [profileId, setProfileId] = useState(() => isDemoMode ? (mockVoiceProfiles.find((profile) => profile.isProduction)?.id ?? "") : "");
  const [mode, setMode] = useState<Exclude<ProductionMode, "regeneration">>("calibration");
  const [preflight, setPreflight] = useState<ProductionPreflight | null>(null);
  const [checking, setChecking] = useState(false);
  const [batch, setBatch] = useState<TtsBatch | null>(() => isDemoMode ? mockActiveBatch : null);
  const [starting, setStarting] = useState(false);
  const [clipLimit, setClipLimit] = useState(2_000);
  const [chunkSize, setChunkSize] = useState(1_000);
  const [preflightSelection, setPreflightSelection] = useState<{ missingOnly: boolean; limit: number } | undefined>();
  const pollingId = useRef<number | null>(null);
  const selectedProfile = profiles.find((profile) => profile.id === profileId) ?? profiles.find((profile) => profile.isProduction);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (isDemoMode) return;
      try {
        const [nextProfiles, batches, dashboard, rawSettings] = await Promise.all([api.voiceProfiles(projectId), api.batches(projectId, 8), api.dashboard(projectId), api.settings()]);
        if (cancelled) return;
        setProfiles(nextProfiles);
        setBatch(dashboard.activeBatch ?? batches.find((candidate) => ["queued", "running", "retry_wait", "partial", "failed"].includes(candidate.status)) ?? batches[0] ?? null);
        if (typeof rawSettings === "object" && rawSettings !== null) {
          const limits = (rawSettings as { limits?: unknown }).limits;
          if (typeof limits === "object" && limits !== null) {
            const serverLimit = (limits as { clipsPerBatch?: unknown }).clipsPerBatch;
            if (typeof serverLimit === "number" && serverLimit > 0) {
              setClipLimit(serverLimit);
              setChunkSize(Math.min(1_000, serverLimit));
            }
          }
        }
        const production = nextProfiles.find((profile) => profile.isProduction) ?? nextProfiles.find((profile) => profile.lockedAt);
        setProfileId(production?.id ?? "");
      } catch (error) {
        if (!cancelled) {
          if (isServerUnavailable(error)) onServerUnavailable();
          else notify("error", "Production workspace could not load", error instanceof Error ? error.message : "Please try again.");
        }
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [isDemoMode, notify, onServerUnavailable, projectId]);

  useEffect(() => {
    if (pollingId.current !== null) window.clearInterval(pollingId.current);
    if (!batch || isDemoMode || !["queued", "running", "retry_wait"].includes(batch.status)) return undefined;
    pollingId.current = window.setInterval(() => {
      void api.batch(batch.id).then(setBatch).catch(() => undefined);
    }, 2_000);
    return () => {
      if (pollingId.current !== null) window.clearInterval(pollingId.current);
    };
  }, [batch?.id, batch?.status, isDemoMode]);

  const runPreflight = async () => {
    if (!selectedProfile) return;
    setChecking(true);
    try {
      let selection: { missingOnly: boolean; limit: number } | undefined;
      if (!isDemoMode && mode === "first_pass") {
        selection = { missingOnly: true, limit: Math.min(chunkSize, clipLimit) };
      }
      setPreflightSelection(selection);
      setPreflight(isDemoMode ? mockPreflight(mode) : await api.preflight(projectId, selectedProfile.id, mode, undefined, selection));
    } catch (error) {
      notify("error", "Preflight did not finish", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setChecking(false);
    }
  };

  const startBatch = async () => {
    if (!selectedProfile || !preflight?.canStart) return;
    setStarting(true);
    try {
      const nextBatch = isDemoMode
        ? { ...mockActiveBatch, id: `batch_demo_${Date.now()}`, mode, status: "running" as const, totalJobs: preflight.totalRequests, completedJobs: 0, failedJobs: 0, queuedJobs: Math.max(0, preflight.totalRequests - 2), runningJobs: Math.min(2, preflight.totalRequests) }
        : await api.createBatch(projectId, selectedProfile.id, mode, undefined, preflightSelection);
      setBatch(nextBatch);
      setPreflight(null);
      notify("success", mode === "calibration" ? "Calibration started" : "Full batch started", "The persistent queue can safely continue if you leave this page.");
    } catch (error) {
      notify("error", "Batch did not start", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setStarting(false);
    }
  };

  const cancelBatch = async () => {
    if (!batch) return;
    try {
      setBatch(isDemoMode ? { ...batch, status: "canceled", runningJobs: 0, queuedJobs: 0, activeRequests: 0 } : await api.cancelBatch(batch.id));
      notify("info", "Queued work canceled", "Successful audio files were preserved.");
    } catch (error) {
      notify("error", "Batch did not cancel", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const retryBatch = async () => {
    if (!batch) return;
    try {
      setBatch(isDemoMode ? { ...batch, status: "running", queuedJobs: batch.failedJobs, failedJobs: 0 } : await api.retryBatch(batch.id));
      notify("success", "Failed jobs requeued", "Only unsuccessful jobs will run again.");
    } catch (error) {
      notify("error", "Retry did not start", error instanceof Error ? error.message : "Please try again.");
    }
  };

  return (
    <div className="page-stack production-page">
      <PageHeader
        eyebrow="Step 3 of 4"
        title="Audio production"
        description="Make a small calibration, then generate one take for every pending or kept phrase. Exact successful recipes are reused."
        actions={selectedProfile ? <Badge tone="success"><Volume2 size={14} /> Voice profile v{selectedProfile.version}</Badge> : <Badge tone="danger">Voice profile required</Badge>}
      />

      {!selectedProfile ? (
        <Card><EmptyState icon={<Volume2 />} title="Lock a voice profile first" description="Large audio batches are blocked until a versioned production recipe is locked." action={<Button onClick={() => onNavigate("voice")}>Open voice profile <ArrowRight size={16} /></Button>} /></Card>
      ) : (
        <>
          <Card className="production-recipe-strip">
            <div className="production-recipe-strip__identity"><span><ShieldCheck size={20} /></span><div><strong>{selectedProfile.label} · v{selectedProfile.version}</strong><small>{selectedProfile.voiceName} · {selectedProfile.modelId}</small></div></div>
            <div className="recipe-chips"><span>Stability {selectedProfile.settings.stability.toFixed(2)}</span><span>Style {selectedProfile.settings.style.toFixed(2)}</span><span>Speed {selectedProfile.settings.speed.toFixed(2)}</span><span>{selectedProfile.outputFormat}</span></div>
          </Card>

          <div className="mode-grid">
            {(Object.entries(MODE_DETAILS) as Array<[Exclude<ProductionMode, "regeneration">, (typeof MODE_DETAILS)[Exclude<ProductionMode, "regeneration">]]>).map(([id, detail]) => (
              <button className={cx("mode-card", mode === id && "is-selected")} key={id} type="button" onClick={() => { setMode(id); setPreflight(null); }}>
                <span className="mode-card__icon">{detail.icon}</span>
                <span><small>{detail.eyebrow}</small><strong>{detail.title}</strong><p>{detail.description}</p></span>
                <span className="selection-check">{mode === id ? <Check size={15} /> : null}</span>
              </button>
            ))}
          </div>

          <Card className="preflight-card">
            <div className="card-heading"><div><p className="eyebrow">Before credits are used</p><h2>Production preflight</h2></div><Button loading={checking} onClick={() => void runPreflight()}><ShieldCheck size={16} /> Check this batch</Button></div>
            {mode === "first_pass" ? <div className="chunk-control"><Field label="Next recipes needing audio"><input type="number" min={1} max={clipLimit} value={chunkSize} onChange={(event) => { setChunkSize(Math.max(1, Math.min(clipLimit, event.currentTarget.valueAsNumber || 1))); setPreflight(null); }} /></Field><p>Voice Foundry selects the next exact voice/text recipes that are not cached. Run another chunk afterward; the server limit is {formatNumber(clipLimit)} clips per batch.</p></div> : null}
            {!preflight ? (
              <div className="preflight-empty"><Zap size={26} /><p>Count eligible phrases, new requests, cached results, and characters before starting.</p></div>
            ) : (
              <div className="preflight-results">
                <div className="preflight-metrics">
                  <PreflightMetric label="Eligible phrases" value={preflight.eligiblePhrases} />
                  <PreflightMetric label="New requests" value={preflight.totalRequests} accent />
                  <PreflightMetric label="Already cached" value={preflight.cachedRequests} />
                  <PreflightMetric label="Characters" value={preflight.totalCharacters} />
                </div>
                {preflight.warnings.length > 0 ? <div className={cx("inline-alert", preflight.canStart ? "inline-alert--warning" : "inline-alert--danger")}><AlertTriangle size={18} /><div><strong>{preflight.canStart ? "A note before starting" : "This batch is blocked"}</strong>{preflight.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div></div> : null}
                <div className="preflight-confirm"><div><ShieldCheck size={20} /><span><strong>{preflight.totalRequests === 0 ? "No new provider requests needed" : `${formatNumber(preflight.totalRequests)} new audio requests`}</strong><small>{preflight.estimatedCredits == null ? "Provider estimate unavailable" : `Estimated usage: ${formatNumber(preflight.estimatedCredits)} units`}</small></span></div><Button size="lg" loading={starting} disabled={!preflight.canStart || (preflight.totalRequests === 0 && !(mode === "calibration" && preflight.cachedRequests > 0))} onClick={() => void startBatch()}><Play size={16} /> Start {mode === "calibration" ? "calibration" : "full batch"}</Button></div>
              </div>
            )}
          </Card>

          {batch ? <BatchPanel batch={batch} onCancel={cancelBatch} onRetry={retryBatch} onReview={() => onNavigate("review")} /> : null}
        </>
      )}
    </div>
  );
}

function PreflightMetric({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return <div className={cx("preflight-metric", accent && "preflight-metric--accent")}><strong>{formatNumber(value)}</strong><span>{label}</span></div>;
}

function BatchPanel({ batch, onCancel, onRetry, onReview }: { batch: TtsBatch; onCancel: () => void; onRetry: () => void; onReview: () => void }) {
  const progress = percent(batch.completedJobs + batch.failedJobs, batch.totalJobs);
  const active = ["queued", "running", "retry_wait"].includes(batch.status);
  return (
    <Card className="batch-card">
      <div className="card-heading"><div><p className="eyebrow">Persistent queue</p><h2>{batch.mode === "calibration" ? "Calibration" : batch.mode === "first_pass" ? "Full phrase batch" : "Targeted regeneration"}</h2></div><BatchStatus status={batch.status} /></div>
      <div className="batch-progress-row"><div className="batch-progress-copy"><strong>{batch.completedJobs}</strong><span>of {batch.totalJobs} complete</span></div><div className="batch-progress-bar"><ProgressBar value={progress} label="Audio queue completion" /><span>{progress}%</span></div></div>
      <div className="batch-stats"><span><Check /> {batch.completedJobs} complete</span><span><Activity /> {batch.runningJobs} active</span><span><Clock3 /> {batch.queuedJobs} waiting</span><span className={batch.failedJobs > 0 ? "has-error" : undefined}><AlertTriangle /> {batch.failedJobs} failed</span></div>
      {batch.lastError ? <div className="inline-alert inline-alert--danger"><AlertTriangle size={18} /><div><strong>Latest error</strong><p>{batch.lastError}</p></div></div> : null}
      <div className="batch-actions"><span>{batch.activeRequests} simultaneous provider {batch.activeRequests === 1 ? "request" : "requests"}</span><div className="button-row">{active ? <Button variant="danger" size="sm" onClick={onCancel}><CircleStop size={15} /> Cancel queued</Button> : null}{batch.failedJobs > 0 || batch.status === "failed" || batch.status === "partial" ? <Button variant="secondary" size="sm" onClick={onRetry}><RefreshCw size={15} /> Retry failed</Button> : null}{batch.completedJobs > 0 ? <Button size="sm" onClick={onReview}><Headphones size={15} /> Review ready clips</Button> : null}</div></div>
    </Card>
  );
}

function BatchStatus({ status }: { status: TtsBatch["status"] }) {
  if (status === "running") return <Badge tone="orange"><Activity size={13} /> Running</Badge>;
  if (status === "succeeded") return <Badge tone="success"><Check size={13} /> Complete</Badge>;
  if (status === "partial") return <Badge tone="warning"><AlertTriangle size={13} /> Partially complete</Badge>;
  if (status === "failed") return <Badge tone="danger">Failed</Badge>;
  if (status === "canceled") return <Badge tone="neutral">Canceled</Badge>;
  return <Badge tone="info">{status.replaceAll("_", " ")}</Badge>;
}
