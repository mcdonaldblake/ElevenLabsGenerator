import {
  Activity,
  Check,
  CircleAlert,
  CloudCog,
  Database,
  Gauge,
  HardDrive,
  KeyRound,
  Laptop,
  Save,
  Server,
  ShieldCheck,
  Volume2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api, isServerUnavailable } from "../lib/api";
import { formatDate, formatNumber, percent } from "../lib/format";
import { mockUsage } from "../lib/mock-data";
import type { HealthStatus, UsageSummary } from "../types";
import { Badge, Button, Card, Field, PageHeader, ProgressBar, Toggle, cx } from "../components/ui";

type LocalPreferences = {
  concurrency: number;
  maximumClips: number;
  maximumCharacters: number;
  autoAdvance: boolean;
};

function settingsRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

const PREFERENCES_KEY = "voice-foundry-preferences-v1";

function readPreferences(): LocalPreferences {
  try {
    const value = localStorage.getItem(PREFERENCES_KEY);
    if (value) return { concurrency: 2, maximumClips: 1_000, maximumCharacters: 100_000, autoAdvance: true, ...JSON.parse(value) as Partial<LocalPreferences> };
  } catch {
    // Device-only preferences safely fall back to conservative defaults.
  }
  return { concurrency: 2, maximumClips: 1_000, maximumCharacters: 100_000, autoAdvance: true };
}

type SettingsPageProps = {
  health: HealthStatus;
  isDemoMode: boolean;
  onServerUnavailable: () => void;
  notify: (tone: "success" | "error" | "info", title: string, detail: string) => void;
};

export function SettingsPage({ health, isDemoMode, onServerUnavailable, notify }: SettingsPageProps) {
  const [usage, setUsage] = useState<UsageSummary>(() => isDemoMode ? mockUsage : { provider: "ElevenLabs", usedCharacters: 0, includedCharacters: null, remainingCharacters: null, periodEndsAt: null, totalRequests: 0 });
  const [preferences, setPreferences] = useState<LocalPreferences>(readPreferences);
  const [limitsLoaded, setLimitsLoaded] = useState(isDemoMode);
  const [testing, setTesting] = useState(false);
  const [connectionResult, setConnectionResult] = useState<"untested" | "connected" | "failed">("untested");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (isDemoMode) {
        setLimitsLoaded(true);
        return;
      }
      try {
        const [nextUsage, rawSettings] = await Promise.all([api.usage(), api.settings()]);
        if (!cancelled) {
          setUsage(nextUsage);
          const root = settingsRecord(rawSettings);
          const limits = settingsRecord(root.limits);
          const saved = settingsRecord(root.preferences);
          setPreferences((current) => ({
            ...current,
            concurrency: typeof limits.concurrency === "number" ? limits.concurrency : current.concurrency,
            maximumClips: typeof limits.clipsPerBatch === "number" ? limits.clipsPerBatch : current.maximumClips,
            maximumCharacters: typeof limits.charactersPerBatch === "number" ? limits.charactersPerBatch : current.maximumCharacters,
            autoAdvance: typeof saved.autoAdvance === "boolean" ? saved.autoAdvance : current.autoAdvance,
          }));
          setLimitsLoaded(true);
        }
      } catch (error) {
        if (!cancelled) {
          if (isServerUnavailable(error)) onServerUnavailable();
          else notify("error", "Usage could not load", error instanceof Error ? error.message : "Please try again.");
        }
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [isDemoMode, notify, onServerUnavailable]);

  const savePreferences = async () => {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
    try {
      if (!isDemoMode) await api.updateSettings({ autoAdvance: preferences.autoAdvance });
      notify("success", "Review preference saved", "Automatic advance was updated. Server batch limits remain environment-configured.");
    } catch (error) {
      notify("error", "Preference did not save", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      if (isDemoMode) throw new Error("Start the local server before testing ElevenLabs.");
      await api.testElevenLabs();
      setConnectionResult("connected");
      notify("success", "ElevenLabs connected", "The server verified the saved key without exposing it to the browser.");
    } catch (error) {
      setConnectionResult("failed");
      notify("error", "Connection test failed", error instanceof Error ? error.message : "Check the local environment and try again.");
    } finally {
      setTesting(false);
    }
  };

  const usagePercent = usage.includedCharacters ? percent(usage.usedCharacters, usage.includedCharacters) : 0;

  return (
    <div className="page-stack settings-page">
      <PageHeader
        eyebrow="Local controls"
        title="Settings & usage"
        description="Check the local stack, verify the voice provider, and set conservative production guardrails."
        actions={<Badge tone={health.server === "online" ? "success" : "warning"}><Laptop size={14} /> Local-only</Badge>}
      />

      <div className="settings-grid">
        <Card className="system-status-card">
          <div className="card-heading"><div><p className="eyebrow">System status</p><h2>This computer</h2></div><Badge tone={health.ok ? "success" : "warning"}>{health.ok ? "Healthy" : "Setup needed"}</Badge></div>
          <div className="status-list">
            <StatusRow icon={<Server />} label="Local server" value={health.server === "online" ? "Online" : "Offline"} ok={health.server === "online"} />
            <StatusRow icon={<Database />} label="SQLite database" value={health.database === "ready" ? "Ready" : "Unavailable"} ok={health.database === "ready"} />
            <StatusRow icon={<HardDrive />} label="Audio & exports" value="Local filesystem" ok />
            <StatusRow icon={<CloudCog />} label="Provider mode" value={health.providerMode} ok={health.providerMode !== "unconfigured"} />
          </div>
          <div className="local-privacy-note"><ShieldCheck size={19} /><p><strong>No accounts, cloud database, or deployment.</strong> Phrase files, generated audio, review decisions, and exports stay on this computer.</p></div>
        </Card>

        <Card className="provider-card">
          <div className="card-heading"><div><p className="eyebrow">Voice provider</p><h2>ElevenLabs</h2></div><Volume2 size={23} /></div>
          <p className="card-description">The API key is read by the local server from the environment. It is never sent to or stored by React.</p>
          <div className="masked-key"><KeyRound size={17} /><code>••••••••••••</code><span>server-managed</span></div>
          {connectionResult !== "untested" ? <div className={cx("connection-result", connectionResult === "connected" ? "is-success" : "is-error")}>{connectionResult === "connected" ? <Check size={17} /> : <CircleAlert size={17} />}<span>{connectionResult === "connected" ? "Connection verified" : "Connection needs attention"}</span></div> : null}
          <Button variant="secondary" loading={testing} onClick={() => void testConnection()}><Activity size={16} /> Test connection</Button>
          <div className="no-ai-note"><ShieldCheck size={17} /><span><strong>No AI phrase generation.</strong> Voice Foundry only processes phrase files you upload and sends non-discarded text to the selected voice provider.</span></div>
        </Card>

        <Card className="usage-card">
          <div className="card-heading"><div><p className="eyebrow">Current billing period</p><h2>Provider usage</h2></div><Gauge size={23} /></div>
          <div className="usage-number"><strong>{formatNumber(usage.usedCharacters)}</strong><span>{usage.includedCharacters == null ? "characters used" : `of ${formatNumber(usage.includedCharacters)} characters`}</span></div>
          {usage.includedCharacters != null ? <ProgressBar value={usagePercent} label="Provider character usage" tone={usagePercent >= 90 ? "orange" : "navy"} /> : null}
          <div className="usage-breakdown"><div><span>Remaining</span><strong>{usage.remainingCharacters == null ? "—" : formatNumber(usage.remainingCharacters)}</strong></div><div><span>Requests logged</span><strong>{formatNumber(usage.totalRequests)}</strong></div><div><span>Period ends</span><strong>{usage.periodEndsAt ? formatDate(usage.periodEndsAt) : "—"}</strong></div></div>
        </Card>

        <Card className="guardrails-card">
          <div className="card-heading"><div><p className="eyebrow">Production guardrails</p><h2>Conservative defaults</h2></div></div>
          <div className="guardrail-form">
            <Field label="Simultaneous voice requests" hint={limitsLoaded ? "Configured on the local server; shown here as an operator reminder." : "Loading from the local server…"}><input type="number" readOnly value={limitsLoaded ? preferences.concurrency : ""} /></Field>
            <div className="two-column-fields"><Field label="Maximum clips per batch"><input type="number" readOnly value={limitsLoaded ? preferences.maximumClips : ""} /></Field><Field label="Maximum characters per batch"><input type="number" readOnly value={limitsLoaded ? preferences.maximumCharacters : ""} /></Field></div>
            <Toggle checked={preferences.autoAdvance} onChange={(checked) => setPreferences((current) => ({ ...current, autoAdvance: checked }))} label="Advance after keep or discard" description="The audio review screen moves to the next phrase after a saved decision." />
          </div>
          <div className="settings-save-row"><span>Auto-advance is saved locally and by the local server. Batch limits come from its environment.</span><Button onClick={() => void savePreferences()}><Save size={16} /> Save review preference</Button></div>
        </Card>
      </div>
    </div>
  );
}

function StatusRow({ icon, label, value, ok }: { icon: React.ReactNode; label: string; value: string; ok: boolean }) {
  return <div className="status-row"><span aria-hidden="true">{icon}</span><strong>{label}</strong><span>{value}</span><i className={cx(ok && "is-ok")}>{ok ? <Check size={13} /> : <CircleAlert size={13} />}</i></div>;
}
