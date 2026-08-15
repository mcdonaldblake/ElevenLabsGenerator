import {
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Copy,
  Headphones,
  Library,
  Lock,
  Radio,
  Save,
  ShieldCheck,
  Volume2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { SharedVoiceBrowser } from "../components/SharedVoiceBrowser";
import { api, isServerUnavailable } from "../lib/api";
import { formatDate } from "../lib/format";
import { mockAccountVoices, mockVoiceProfiles } from "../lib/mock-data";
import type { AccountVoice, HealthStatus, VoiceProfile, VoiceProfileDraft } from "../types";
import { Badge, Button, Card, EmptyState, Field, PageHeader, Skeleton, Toggle, cx } from "../components/ui";

const DEFAULT_PROFILE_LABEL = "Mara · Production voice";

const DEFAULT_DRAFT = (projectId: string): VoiceProfileDraft => ({
  projectId,
  label: DEFAULT_PROFILE_LABEL,
  voiceId: "",
  voiceName: "",
  modelId: "eleven_multilingual_v2",
  languageCode: "es",
  outputFormat: "mp3_44100_128",
  settings: {
    stability: 0.5,
    similarityBoost: 0.75,
    style: 0.1,
    speed: 1,
    useSpeakerBoost: true,
  },
  notes: "",
});

type VoiceProfilePageProps = {
  projectId: string;
  isDemoMode: boolean;
  providerMode: HealthStatus["providerMode"];
  onServerUnavailable: () => void;
  onOpenSettings: () => void;
  notify: (tone: "success" | "error" | "info", title: string, detail: string) => void;
};

export function VoiceProfilePage({ projectId, isDemoMode, providerMode, onServerUnavailable, onOpenSettings, notify }: VoiceProfilePageProps) {
  const [profiles, setProfiles] = useState<VoiceProfile[]>(() => isDemoMode ? mockVoiceProfiles : []);
  const [voices, setVoices] = useState<AccountVoice[]>(() => isDemoMode ? mockAccountVoices : []);
  const [voiceSource, setVoiceSource] = useState<"account" | "library">("library");
  const [addedSharedVoiceIds, setAddedSharedVoiceIds] = useState<Map<string, string>>(() => new Map());
  const [voicesLoading, setVoicesLoading] = useState(!isDemoMode);
  const [draft, setDraft] = useState<VoiceProfileDraft>(() => DEFAULT_DRAFT(projectId));
  const [savedDraft, setSavedDraft] = useState<VoiceProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [locking, setLocking] = useState(false);

  useEffect(() => {
    setDraft((current) => ({ ...current, projectId }));
    let cancelled = false;
    const load = async () => {
      if (isDemoMode) {
        setProfiles(mockVoiceProfiles);
        setVoices(mockAccountVoices);
        setVoicesLoading(false);
        return;
      }
      setVoicesLoading(true);
      const [profileResult, voiceResult] = await Promise.allSettled([api.voiceProfiles(projectId), api.accountVoices()]);
      if (cancelled) return;
      if (profileResult.status === "fulfilled") setProfiles(profileResult.value);
      else if (isServerUnavailable(profileResult.reason)) {
        onServerUnavailable();
        setProfiles(mockVoiceProfiles);
        setVoices(mockAccountVoices);
        setVoicesLoading(false);
        return;
      } else {
        setProfiles([]);
        notify("error", "Voice profiles could not load", profileResult.reason instanceof Error ? profileResult.reason.message : "Please try again.");
      }
      if (voiceResult.status === "fulfilled") setVoices(voiceResult.value);
      else if (!isServerUnavailable(voiceResult.reason)) {
        setVoices([]);
        notify("info", "Account voices are unavailable", "You can still paste an exact Voice ID below.");
      }
      setVoicesLoading(false);
    };
    void load();
    return () => { cancelled = true; };
  }, [isDemoMode, onServerUnavailable, projectId]);

  const productionProfile = profiles.find((profile) => profile.isProduction) ?? profiles.find((profile) => profile.lockedAt);

  const chooseVoice = (voice: AccountVoice) => {
    setDraft((current) => {
      const previousAutomaticLabel = current.voiceName ? `${current.voiceName} · Production voice` : DEFAULT_PROFILE_LABEL;
      const label = current.label === DEFAULT_PROFILE_LABEL || current.label === previousAutomaticLabel
        ? `${voice.name} · Production voice`
        : current.label;
      return { ...current, label, voiceId: voice.id, voiceName: voice.name };
    });
    setSavedDraft(null);
  };

  const chooseLibraryVoice = (voice: AccountVoice) => {
    const stableVoice = { ...voice, previewUrl: null };
    setVoices((current) => current.some((item) => item.id === stableVoice.id)
      ? current.map((item) => item.id === stableVoice.id ? stableVoice : item)
      : [stableVoice, ...current]);
    chooseVoice(stableVoice);
  };

  const duplicateProfile = (profile: VoiceProfile) => {
    setDraft({
      projectId,
      label: profile.label,
      voiceId: profile.voiceId,
      voiceName: profile.voiceName,
      modelId: profile.modelId,
      languageCode: profile.languageCode,
      outputFormat: profile.outputFormat,
      settings: { ...profile.settings },
      notes: profile.notes,
    });
    setSavedDraft(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
    notify("info", "Editable copy opened", `Changes will create version ${Math.max(...profiles.map((item) => item.version), 0) + 1}; ${profile.label} v${profile.version} stays unchanged.`);
  };

  const saveDraft = async () => {
    if (!draft.voiceId || !draft.label.trim()) return;
    setSaving(true);
    try {
      const profile = isDemoMode
        ? {
            ...draft,
            id: `profile_demo_${Date.now()}`,
            version: Math.max(...profiles.map((item) => item.version), 0) + 1,
            lockedAt: null,
            isProduction: false,
            createdAt: new Date().toISOString(),
          }
        : await api.createVoiceProfile(draft);
      setProfiles((current) => [profile, ...current]);
      setSavedDraft(profile);
      notify("success", `Voice profile v${profile.version} saved`, "Review the exact recipe, then lock it before starting a full batch.");
    } catch (error) {
      notify("error", "Profile did not save", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const lockProfile = async () => {
    if (!savedDraft) return;
    setLocking(true);
    try {
      const locked = isDemoMode
        ? { ...savedDraft, lockedAt: new Date().toISOString(), isProduction: true }
        : await api.lockVoiceProfile(savedDraft.id);
      setProfiles((current) => current.map((profile) => profile.id === locked.id ? locked : { ...profile, isProduction: false }));
      setSavedDraft(locked);
      notify("success", `Production profile v${locked.version} locked`, "Audio jobs will preserve this exact voice recipe.");
    } catch (error) {
      notify("error", "Profile did not lock", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setLocking(false);
    }
  };

  return (
    <div className="page-stack voice-page">
      <PageHeader
        eyebrow="Voice recipe"
        title="Voice profile"
        description="Browse and audition official ElevenLabs samples, choose a voice, then lock an immutable production recipe."
        actions={productionProfile ? <Badge tone="success"><ShieldCheck size={14} /> Production v{productionProfile.version}</Badge> : <Badge tone="warning">No locked profile</Badge>}
      />

      {productionProfile ? (
        <Card className="production-profile-banner">
          <div className="production-profile-banner__icon"><Volume2 size={25} /></div>
          <div><p className="eyebrow">Current production profile</p><h2>{productionProfile.label} <span>v{productionProfile.version}</span></h2><p>{productionProfile.voiceName} · {productionProfile.modelId} · speed {productionProfile.settings.speed.toFixed(2)}</p></div>
          <Button variant="secondary" onClick={() => duplicateProfile(productionProfile)}><Copy size={16} /> Duplicate to edit</Button>
        </Card>
      ) : null}

      <div className="voice-layout">
        <div className="page-stack page-stack--tight">
          <Card className="voice-picker-card">
            <div className="card-heading"><div><p className="eyebrow">1 · Voice identity</p><h2>Choose the voice identity</h2></div>{draft.voiceName ? <Badge tone="success"><Check size={14} /> {draft.voiceName}</Badge> : <Badge tone="neutral">Not selected</Badge>}</div>
            <div className="voice-source-tabs" role="tablist" aria-label="Voice source">
              <button id="voice-source-library-tab" type="button" role="tab" aria-controls="voice-source-panel" aria-selected={voiceSource === "library"} className={voiceSource === "library" ? "is-active" : undefined} onClick={() => setVoiceSource("library")}><Library size={17} /><span>Browse library<small>Official previews</small></span></button>
              <button id="voice-source-account-tab" type="button" role="tab" aria-controls="voice-source-panel" aria-selected={voiceSource === "account"} className={voiceSource === "account" ? "is-active" : undefined} onClick={() => setVoiceSource("account")}><Headphones size={17} /><span>My voices<small>{voices.length} in account</small></span></button>
            </div>

            <div id="voice-source-panel" role="tabpanel" aria-labelledby={`voice-source-${voiceSource}-tab`}>
            {voiceSource === "library" ? (
              <SharedVoiceBrowser
                accountVoices={voices}
                selectedVoiceId={draft.voiceId}
                providerMode={providerMode}
                serverUnavailable={isDemoMode}
                addedVoiceIds={addedSharedVoiceIds}
                onChoose={chooseLibraryVoice}
                onVoiceAdded={(sharedVoiceKey, accountVoiceId) => setAddedSharedVoiceIds((current) => new Map(current).set(sharedVoiceKey, accountVoiceId))}
                onOpenSettings={onOpenSettings}
                onServerUnavailable={onServerUnavailable}
                notify={notify}
              />
            ) : voicesLoading ? (
              <div className="voice-list" aria-label="Loading account voices">
                {Array.from({ length: 4 }, (_, index) => <Skeleton className="voice-option-skeleton" key={index} />)}
              </div>
            ) : voices.length > 0 ? (
              <div className="voice-list">
                {voices.map((voice) => (
                  <div className={cx("voice-option", draft.voiceId === voice.id && "is-selected")} key={voice.id}>
                    <span className="voice-avatar"><Radio size={19} /></span>
                    <span className="voice-option__copy"><strong>{voice.name}</strong><small>{voice.description || voice.category}</small><span>{Object.values(voice.labels).join(" · ") || voice.category}</span></span>
                    <Button type="button" variant="ghost" size="sm" onClick={() => chooseVoice(voice)}>{draft.voiceId === voice.id ? <><Check size={15} /> Selected</> : "Choose"}</Button>
                    <span className="selection-check" aria-hidden="true">{draft.voiceId === voice.id ? <Check size={15} /> : null}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={<Volume2 />} title="No account voices yet" description="Browse the shared Voice Library to find a voice, or connect ElevenLabs in Settings to load your account voices." action={<Button type="button" variant="secondary" onClick={() => setVoiceSource("library")}><Library size={16} /> Browse Voice Library</Button>} />
            )}
            </div>
          </Card>

          <Card className="recipe-card">
            <div className="card-heading"><div><p className="eyebrow">2 · Delivery recipe</p><h2>Versioned production settings</h2></div><Badge tone="info">Changing anything creates a new version</Badge></div>
            <div className="recipe-form">
              <Field label="Profile label"><input value={draft.label} onChange={(event) => { setDraft((current) => ({ ...current, label: event.currentTarget.value })); setSavedDraft(null); }} /></Field>
              <div className="two-column-fields">
                <Field label="Voice ID" hint="Paste the exact provider voice ID if it is not listed above."><input value={draft.voiceId} onChange={(event) => { setDraft((current) => ({ ...current, voiceId: event.currentTarget.value })); setSavedDraft(null); }} placeholder="Provider voice ID" /></Field>
                <Field label="Voice name" hint="Optional label used in this workspace and export snapshot."><input value={draft.voiceName} onChange={(event) => { setDraft((current) => ({ ...current, voiceName: event.currentTarget.value })); setSavedDraft(null); }} placeholder="Mara" /></Field>
              </div>
              <div className="two-column-fields">
                <Field label="Model ID"><input value={draft.modelId} onChange={(event) => { setDraft((current) => ({ ...current, modelId: event.currentTarget.value })); setSavedDraft(null); }} /></Field>
                <Field label="Language code"><input value={draft.languageCode ?? ""} onChange={(event) => { setDraft((current) => ({ ...current, languageCode: event.currentTarget.value || null })); setSavedDraft(null); }} /></Field>
              </div>
              <Field label="Output format"><select value={draft.outputFormat} onChange={(event) => { setDraft((current) => ({ ...current, outputFormat: event.currentTarget.value })); setSavedDraft(null); }}><option value="mp3_44100_128">MP3 · 44.1 kHz · 128 kbps</option><option value="mp3_44100_192">MP3 · 44.1 kHz · 192 kbps</option></select></Field>
              <SliderField label="Stability" value={draft.settings.stability} min={0} max={1} step={0.01} onChange={(value) => { setDraft((current) => ({ ...current, settings: { ...current.settings, stability: value } })); setSavedDraft(null); }} />
              <SliderField label="Similarity boost" value={draft.settings.similarityBoost} min={0} max={1} step={0.01} onChange={(value) => { setDraft((current) => ({ ...current, settings: { ...current.settings, similarityBoost: value } })); setSavedDraft(null); }} />
              <SliderField label="Style" value={draft.settings.style} min={0} max={1} step={0.01} onChange={(value) => { setDraft((current) => ({ ...current, settings: { ...current.settings, style: value } })); setSavedDraft(null); }} />
              <SliderField label="Speed" value={draft.settings.speed} min={0.7} max={1.2} step={0.01} onChange={(value) => { setDraft((current) => ({ ...current, settings: { ...current.settings, speed: value } })); setSavedDraft(null); }} />
              <Toggle checked={draft.settings.useSpeakerBoost} onChange={(checked) => { setDraft((current) => ({ ...current, settings: { ...current.settings, useSpeakerBoost: checked } })); setSavedDraft(null); }} label="Speaker boost" description="Use the provider’s voice similarity enhancement." />
              <Field label="Recipe notes" hint="Record why this version exists; notes are included in the exported snapshot."><textarea rows={3} value={draft.notes} onChange={(event) => { setDraft((current) => ({ ...current, notes: event.currentTarget.value })); setSavedDraft(null); }} /></Field>
            </div>
            <div className="recipe-actions">
              <span>{draft.voiceName ? <>Selected voice: <strong>{draft.voiceName}</strong></> : "Choose an account voice to continue."}</span>
              <Button loading={saving} disabled={!draft.voiceId || !draft.label.trim()} onClick={() => void saveDraft()}><Save size={16} /> Save new version</Button>
            </div>
          </Card>

          {savedDraft && !savedDraft.lockedAt ? (
            <Card className="lock-card">
              <div><Lock size={24} /><span><strong>Ready to lock v{savedDraft.version}?</strong><small>A locked recipe cannot be edited. Duplicate it later to create another version.</small></span></div>
              <Button loading={locking} onClick={() => void lockProfile()}><Lock size={16} /> Lock for production</Button>
            </Card>
          ) : null}
        </div>

        <Card className="profile-history-card">
          <div className="card-heading"><div><p className="eyebrow">Version history</p><h2>Saved profiles</h2></div></div>
          <div className="profile-timeline">
            {profiles.map((profile) => (
              <button type="button" className={cx("profile-version", profile.isProduction && "is-production")} key={profile.id} onClick={() => duplicateProfile(profile)}>
                <span className="profile-version__marker">{profile.lockedAt ? <Lock size={14} /> : <Clock3 size={14} />}</span>
                <span><strong>v{profile.version} · {profile.label}</strong><small>{profile.voiceName || profile.voiceId} · {formatDate(profile.createdAt)}</small><span>{profile.lockedAt ? "Locked" : "Draft"}{profile.isProduction ? " · Production" : ""}</span></span>
                <ChevronRight size={17} />
              </button>
            ))}
            {profiles.length === 0 ? <p className="muted">Saved versions will appear here.</p> : null}
          </div>
          <div className="immutability-note"><CheckCircle2 size={18} /><p><strong>Recipes stay traceable.</strong> Every audio take references the exact profile version used to make it.</p></div>
        </Card>
      </div>
    </div>
  );
}

function SliderField({ label, value, min, max, step, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="slider-field">
      <span><strong>{label}</strong><output>{value.toFixed(2)}</output></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(event.currentTarget.valueAsNumber)} />
    </label>
  );
}
