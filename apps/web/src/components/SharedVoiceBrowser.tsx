import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Library,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  VolumeX,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiRequestError, api, isServerUnavailable } from "../lib/api";
import type { AccountVoice, HealthStatus, SharedVoice, SharedVoicePage } from "../types";
import { Badge, Button, EmptyState, SearchInput, Skeleton, cx } from "./ui";

const PAGE_SIZE = 24;

type SharedVoiceFilters = {
  language: string;
  accent: string;
  gender: string;
  age: string;
  category: string;
  useCase: string;
  featured: boolean;
  sort: string;
};

const EMPTY_FILTERS: SharedVoiceFilters = {
  language: "",
  accent: "",
  gender: "",
  age: "",
  category: "",
  useCase: "",
  featured: false,
  sort: "trending",
};

export function classifySharedVoiceBrowseError(error: unknown): "authentication" | "permissions" | "other" {
  if (!(error instanceof ApiRequestError)) return "other";
  if (error.status === 401 || error.code === "ELEVENLABS_INVALID_API_KEY") return "authentication";
  if (error.status === 403) return "permissions";
  return "other";
}

type SharedVoiceBrowserProps = {
  accountVoices: AccountVoice[];
  selectedVoiceId: string;
  providerMode: HealthStatus["providerMode"];
  serverUnavailable: boolean;
  addedVoiceIds: ReadonlyMap<string, string>;
  onChoose: (voice: AccountVoice) => void;
  onVoiceAdded: (sharedVoiceKey: string, accountVoiceId: string) => void;
  onOpenSettings: () => void;
  onServerUnavailable: () => void;
  notify: (tone: "success" | "error" | "info", title: string, detail: string) => void;
};

function voiceKey(voice: SharedVoice): string {
  return `${voice.publicOwnerId}:${voice.voiceId}`;
}

function toAccountVoice(voice: SharedVoice, voiceId = voice.voiceId): AccountVoice {
  return {
    id: voiceId,
    name: voice.name,
    category: voice.category || "Shared voice",
    description: voice.description,
    labels: {
      ...(voice.language ? { language: voice.language } : {}),
      ...(voice.accent ? { accent: voice.accent } : {}),
      ...(voice.gender ? { gender: voice.gender } : {}),
    },
    previewUrl: voice.previewUrl,
  };
}

function voiceDetails(voice: SharedVoice): string[] {
  return [
    voice.language,
    voice.locale ?? "",
    voice.accent,
    voice.gender,
    voice.age,
    voice.useCase[0] ?? "",
  ].filter(Boolean).slice(0, 5);
}

export function SharedVoiceBrowser({
  accountVoices,
  selectedVoiceId,
  providerMode,
  serverUnavailable,
  addedVoiceIds,
  onChoose,
  onVoiceAdded,
  onOpenSettings,
  onServerUnavailable,
  notify,
}: SharedVoiceBrowserProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const activePreviewKey = useRef<string | null>(null);
  const checkingPreviewAccess = useRef(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<SharedVoiceFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<SharedVoicePage | null>(null);
  const [loading, setLoading] = useState(!serverUnavailable);
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [planRestricted, setPlanRestricted] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [previewLoadingKey, setPreviewLoadingKey] = useState<string | null>(null);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [previewErrorKey, setPreviewErrorKey] = useState<string | null>(null);

  const accountVoiceIds = useMemo(() => new Set(accountVoices.map((voice) => voice.id)), [accountVoices]);
  const activeFilterCount = Object.entries(filters).filter(([key, value]) => key !== "sort" && Boolean(value)).length;

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPage(0);
      setSearch(searchInput.trim());
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    if (serverUnavailable) {
      setLoading(false);
      setResult(null);
      setError(null);
      setAuthRequired(false);
      setPlanRestricted(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setAuthRequired(false);
    setPlanRestricted(false);
    void api.sharedVoices({
      page,
      pageSize: PAGE_SIZE,
      ...(search ? { search } : {}),
      ...(filters.language ? { language: filters.language } : {}),
      ...(filters.accent ? { accent: filters.accent } : {}),
      ...(filters.gender ? { gender: filters.gender } : {}),
      ...(filters.age ? { age: filters.age } : {}),
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.useCase ? { useCase: filters.useCase } : {}),
      ...(filters.featured ? { featured: true } : {}),
      ...(filters.sort ? { sort: filters.sort } : {}),
    }).then((nextResult) => {
      if (!cancelled) setResult(nextResult);
    }).catch((loadError: unknown) => {
      if (!cancelled) {
        setResult(null);
        const errorKind = classifySharedVoiceBrowseError(loadError);
        const authenticationRequired = errorKind === "authentication";
        const restricted = errorKind === "permissions";
        setAuthRequired(authenticationRequired);
        setPlanRestricted(restricted);
        setError(authenticationRequired
          ? "ElevenLabs did not accept the Voice Library request. Add or replace the API key in Settings, restart the Mac server, then try again."
          : restricted
            ? "The connected ElevenLabs plan or API-key permissions do not allow Voice Library access. Check the account plan and key permissions, then try again."
            : loadError instanceof Error ? loadError.message : "The shared Voice Library could not load.");
      }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [filters, page, retryKey, search, serverUnavailable]);

  useEffect(() => () => {
    const audio = audioRef.current;
    audio?.pause();
    if (audio) audio.removeAttribute("src");
  }, []);

  const updateFilter = <Key extends keyof SharedVoiceFilters>(key: Key, value: SharedVoiceFilters[Key]) => {
    setPage(0);
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setFilters(EMPTY_FILTERS);
    setPage(0);
  };

  const togglePreview = async (voice: SharedVoice) => {
    if (!voice.previewUrl || !audioRef.current) return;
    const audio = audioRef.current;
    const key = voiceKey(voice);

    if ((playingKey === key && !audio.paused) || previewLoadingKey === key) {
      audio.pause();
      setPreviewLoadingKey(null);
      return;
    }

    audio.pause();
    activePreviewKey.current = key;
    setPlayingKey(null);
    setPreviewLoadingKey(key);
    setPreviewErrorKey(null);
    audio.src = api.sharedVoicePreviewUrl(voice.previewUrl);
    audio.load();
    try {
      await audio.play();
    } catch {
      await handlePreviewError(key);
    }
  };

  const handlePreviewError = async (key: string) => {
    if (checkingPreviewAccess.current) return;
    checkingPreviewAccess.current = true;
    if (activePreviewKey.current === key) {
      setPlayingKey(null);
      setPreviewLoadingKey(null);
    }
    try {
      const access = await api.recheckAccess();
      if (!access.requiresPairing && activePreviewKey.current === key) setPreviewErrorKey(key);
    } catch (accessError) {
      if (isServerUnavailable(accessError)) onServerUnavailable();
      else notify("error", "Preview access could not be checked", accessError instanceof Error ? accessError.message : "Please try again.");
    } finally {
      checkingPreviewAccess.current = false;
    }
  };

  const chooseOrAdd = async (voice: SharedVoice) => {
    const key = voiceKey(voice);
    const availableVoiceId = addedVoiceIds.get(key) ?? (accountVoiceIds.has(voice.voiceId) ? voice.voiceId : null);
    if (availableVoiceId) {
      onChoose(toAccountVoice(voice, availableVoiceId));
      notify("success", `${voice.name} selected`, "This voice is ready for a versioned delivery recipe.");
      return;
    }
    if (providerMode !== "live") {
      notify("info", "Connect ElevenLabs to add this voice", "Open Settings, configure the ElevenLabs provider, then return to add it to your account.");
      return;
    }

    setAddingKey(key);
    try {
      const added = await api.addSharedVoice(voice.publicOwnerId, voice.voiceId, voice.name);
      onVoiceAdded(key, added.voiceId);
      onChoose(toAccountVoice(voice, added.voiceId));
      notify("success", `${voice.name} added and selected`, "The provider preview was free; paid usage begins only when you generate phrase audio.");
    } catch (addError) {
      if (addError instanceof ApiRequestError && (addError.status === 401 || addError.status === 403)) {
        notify("error", "ElevenLabs access needs attention", "The API key permissions or ElevenLabs plan may not allow adding Voice Library voices. Check the key and plan in Settings, then try again.");
      } else {
        notify("error", "Voice could not be added", addError instanceof Error ? addError.message : "Check the ElevenLabs connection and try again.");
      }
    } finally {
      setAddingKey(null);
    }
  };

  const voices = result?.voices ?? [];
  const totalLabel = result?.totalCount == null
    ? `${voices.length} on this page`
    : `${result.totalCount.toLocaleString()} voices`;

  return (
    <div className="shared-voice-browser">
      <div className="shared-voice-browser__intro">
        <div>
          <span className="shared-voice-browser__icon" aria-hidden="true"><Library size={20} /></span>
          <span><strong>ElevenLabs Voice Library</strong><small>Listen to official provider samples. Previews do not generate speech or spend TTS credits.</small></span>
        </div>
        {providerMode === "live" ? (
          <Badge tone="success"><Check size={14} /> Ready to add</Badge>
        ) : (
          <Button type="button" variant="secondary" size="sm" onClick={onOpenSettings}>Connect to add</Button>
        )}
      </div>

      {serverUnavailable ? (
        <EmptyState
          icon={<CircleAlert />}
          title="Mac server unavailable"
          description="Start Voice Foundry on the Mac and reconnect this iPhone before browsing official previews."
        />
      ) : null}

      {!serverUnavailable ? <>
      <div className="shared-voice-toolbar">
        <SearchInput
          icon={<Search size={17} />}
          value={searchInput}
          onChange={(event) => setSearchInput(event.currentTarget.value)}
          placeholder="Search voices, accents, or styles"
          aria-label="Search the ElevenLabs Voice Library"
        />
        <button
          type="button"
          className={cx("featured-filter", filters.featured && "is-active")}
          aria-pressed={filters.featured}
          onClick={() => updateFilter("featured", !filters.featured)}
        >
          <Sparkles size={16} /> Featured
        </button>
      </div>

      <div className="shared-voice-filters" aria-label="Voice Library filters">
        <span className="shared-voice-filters__label"><SlidersHorizontal size={15} /> Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}</span>
        <FilterSelect label="Language" value={filters.language} onChange={(value) => updateFilter("language", value)} options={[
          ["es", "Spanish"], ["en", "English"], ["fr", "French"], ["de", "German"], ["it", "Italian"], ["pt", "Portuguese"],
        ]} />
        <FilterSelect label="Accent" value={filters.accent} onChange={(value) => updateFilter("accent", value)} options={[
          ["mexican", "Mexican"], ["latin american", "Latin American"], ["castilian", "Castilian"], ["american", "American"], ["british", "British"],
        ]} />
        <FilterSelect label="Gender" value={filters.gender} onChange={(value) => updateFilter("gender", value)} options={[
          ["female", "Female"], ["male", "Male"], ["neutral", "Neutral"],
        ]} />
        <FilterSelect label="Age" value={filters.age} onChange={(value) => updateFilter("age", value)} options={[
          ["young", "Young"], ["middle aged", "Middle aged"], ["old", "Older"],
        ]} />
        <FilterSelect label="Use" value={filters.useCase} onChange={(value) => updateFilter("useCase", value)} options={[
          ["conversational", "Conversational"], ["narrative_story", "Narration"], ["characters_animation", "Characters"], ["social_media", "Social media"],
        ]} />
        <FilterSelect label="Category" value={filters.category} onChange={(value) => updateFilter("category", value)} options={[
          ["professional", "Professional"], ["famous", "Famous"], ["high_quality", "High quality"],
        ]} />
        <FilterSelect label="Sort" includeAny={false} value={filters.sort} onChange={(value) => updateFilter("sort", value)} options={[
          ["trending", "Trending"], ["cloned_by_count", "Popular"], ["usage_character_count_1y", "Most used"], ["created_date", "Newest"],
        ]} />
        {activeFilterCount > 0 || search ? <Button type="button" variant="ghost" size="sm" onClick={clearFilters}><RotateCcw size={14} /> Clear</Button> : null}
      </div>

      <div className="shared-voice-results-heading" aria-live="polite">
        <span>{loading ? "Loading voices…" : error ? "Voice Library unavailable" : totalLabel}</span>
        {!loading && !error && result ? <small>Page {result.page + 1}</small> : null}
      </div>

      {loading ? <VoiceGridSkeleton /> : null}

      {!loading && error ? (
        <EmptyState
          icon={<CircleAlert />}
          title={authRequired ? "Connect ElevenLabs to browse" : "Couldn’t load the Voice Library"}
          description={error}
          action={<div className="button-row">
            <Button type="button" variant="secondary" onClick={() => setRetryKey((current) => current + 1)}><RotateCcw size={16} /> Try again</Button>
            {authRequired || planRestricted ? <Button type="button" variant="ghost" onClick={onOpenSettings}>Connection settings</Button> : null}
          </div>}
        />
      ) : null}

      {!loading && !error && voices.length === 0 ? (
        <EmptyState
          icon={<VolumeX />}
          title="No voices match these filters"
          description="Try a broader search or clear one or more filters."
          action={<Button type="button" variant="secondary" onClick={clearFilters}>Clear filters</Button>}
        />
      ) : null}

      {!loading && !error && voices.length > 0 ? (
        <div className="shared-voice-grid">
          {voices.map((voice) => {
            const key = voiceKey(voice);
            const availableVoiceId = addedVoiceIds.get(key) ?? (accountVoiceIds.has(voice.voiceId) ? voice.voiceId : null);
            const inAccount = availableVoiceId !== null;
            const selected = availableVoiceId !== null && selectedVoiceId === availableVoiceId;
            const previewing = playingKey === key;
            const previewLoading = previewLoadingKey === key;
            const details = voiceDetails(voice);
            return (
              <article className={cx("shared-voice-card", selected && "is-selected")} key={key}>
                <div className="shared-voice-card__heading">
                  <span className="shared-voice-avatar" aria-hidden="true">{voice.name.slice(0, 1).toLocaleUpperCase()}</span>
                  <span><strong>{voice.name}</strong><small>{voice.category || "Shared voice"}</small></span>
                  {voice.featured ? <Badge tone="orange"><Sparkles size={12} /> Featured</Badge> : null}
                </div>
                <p className="shared-voice-card__description">{voice.description || "Preview this voice to hear its official ElevenLabs sample."}</p>
                {details.length > 0 ? <div className="shared-voice-tags">{details.map((detail, index) => <span key={`${detail}-${index}`}>{detail}</span>)}</div> : null}
                {((voice.rate != null && voice.rate !== 1) || !voice.freeUsersAllowed || voice.liveModerationEnabled) ? (
                  <div className="shared-voice-flags">
                    {voice.rate != null && voice.rate !== 1 ? <Badge tone="warning">×{voice.rate.toLocaleString()} credits</Badge> : null}
                    {!voice.freeUsersAllowed ? <Badge tone="neutral">Paid plan</Badge> : null}
                    {voice.liveModerationEnabled ? <Badge tone="info">Live moderation</Badge> : null}
                  </div>
                ) : null}
                <div className="shared-voice-card__actions">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={!voice.previewUrl}
                    aria-label={voice.previewUrl ? `${previewing ? "Pause" : "Play"} ${voice.name} preview` : `${voice.name} has no preview`}
                    onClick={() => void togglePreview(voice)}
                  >
                    {previewLoading ? <LoaderCircle className="spin" size={15} /> : previewing ? <Pause size={15} /> : voice.previewUrl ? <Play size={15} /> : <VolumeX size={15} />}
                    {previewLoading ? "Loading" : previewing ? "Pause" : voice.previewUrl ? "Preview" : "No preview"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={selected ? "secondary" : "primary"}
                    loading={addingKey === key}
                    disabled={selected}
                    onClick={() => void chooseOrAdd(voice)}
                  >
                    {selected ? <><Check size={15} /> Selected</> : inAccount ? "Choose" : providerMode === "live" ? "Add & choose" : "Connect to add"}
                  </Button>
                </div>
                {previewErrorKey === key ? <p className="shared-voice-card__error">That preview could not play. Try again.</p> : null}
              </article>
            );
          })}
        </div>
      ) : null}

      {!loading && !error && result && (result.page > 0 || result.hasMore) ? (
        <div className="shared-voice-pagination">
          <Button type="button" variant="secondary" disabled={result.page <= 0} onClick={() => setPage((current) => Math.max(0, current - 1))}><ChevronLeft size={16} /> Previous</Button>
          <span>Page <strong>{result.page + 1}</strong>{result.totalCount == null ? "" : ` · ${result.totalCount.toLocaleString()} total`}</span>
          <Button type="button" variant="secondary" disabled={!result.hasMore} onClick={() => setPage((current) => current + 1)}>Next <ChevronRight size={16} /></Button>
        </div>
      ) : null}

      <audio
        ref={audioRef}
        preload="none"
        onPlaying={() => {
          setPreviewLoadingKey(null);
          setPlayingKey(activePreviewKey.current);
        }}
        onPause={() => setPlayingKey(null)}
        onEnded={() => {
          setPlayingKey(null);
          setPreviewLoadingKey(null);
        }}
        onError={() => {
          const key = activePreviewKey.current;
          if (key) void handlePreviewError(key);
        }}
      />
      </> : null}
    </div>
  );
}

function FilterSelect({ label, value, options, defaultLabel, includeAny = true, onChange }: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  defaultLabel?: string;
  includeAny?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="shared-voice-filter">
      <span className="sr-only">{label}</span>
      <select value={value} aria-label={`Filter by ${label.toLocaleLowerCase()}`} onChange={(event) => onChange(event.currentTarget.value)}>
        {includeAny ? <option value="">{defaultLabel ?? `Any ${label.toLocaleLowerCase()}`}</option> : null}
        {options.map(([optionValue, optionLabel]) => <option value={optionValue} key={optionValue}>{optionLabel}</option>)}
      </select>
    </label>
  );
}

function VoiceGridSkeleton() {
  return (
    <div className="shared-voice-grid" aria-label="Loading voices">
      {Array.from({ length: 6 }, (_, index) => (
        <div className="shared-voice-card shared-voice-card--skeleton" key={index}>
          <div className="shared-voice-card__heading"><Skeleton className="skeleton--avatar" /><span><Skeleton /><Skeleton /></span></div>
          <Skeleton /><Skeleton />
          <div className="shared-voice-card__actions"><Skeleton /><Skeleton /></div>
        </div>
      ))}
    </div>
  );
}
