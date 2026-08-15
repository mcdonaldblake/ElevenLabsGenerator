"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addSharedVoice,
  getAccountVoices,
  getSharedVoices,
  previewProxyUrl,
  type SharedVoiceQuery,
} from "./api";
import styles from "./VoiceLab.module.css";
import type { AccountVoice, SharedVoice, SharedVoicePage } from "./types";

const PAGE_SIZE = 18;

type VoiceSource = "library" | "account";
type Filters = {
  language: string;
  accent: string;
  gender: string;
  age: string;
  useCase: string;
  category: string;
  sort: string;
  featured: boolean;
};

const EMPTY_FILTERS: Filters = {
  language: "",
  accent: "",
  gender: "",
  age: "",
  useCase: "",
  category: "",
  sort: "trending",
  featured: false,
};

type VoiceBrowserProps = {
  selectedVoiceId: string;
  onSelect: (voice: AccountVoice) => void;
  onNotice: (tone: "success" | "error" | "info", message: string) => void;
};

function sharedKey(voice: SharedVoice): string {
  return `${voice.publicOwnerId}:${voice.voiceId}`;
}

function voiceTags(voice: SharedVoice): string[] {
  return [voice.language, voice.locale ?? "", voice.accent, voice.gender, voice.age, voice.useCase[0] ?? ""]
    .filter(Boolean)
    .slice(0, 5);
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

function SelectFilter({ label, value, options, onChange, includeAny = true }: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
  includeAny?: boolean;
}) {
  return (
    <label className={styles.filter}>
      <span className={styles.srOnly}>{label}</span>
      <select value={value} aria-label={`Filter by ${label.toLocaleLowerCase()}`} onChange={(event) => onChange(event.currentTarget.value)}>
        {includeAny ? <option value="">Any {label.toLocaleLowerCase()}</option> : null}
        {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
      </select>
    </label>
  );
}

export function VoiceBrowser({ selectedVoiceId, onSelect, onNotice }: VoiceBrowserProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const activePreviewRef = useRef<string | null>(null);
  const previewAttemptRef = useRef(0);
  const previewCleanupRef = useRef<(() => void) | null>(null);
  const voiceMutationRef = useRef(false);
  const [source, setSource] = useState<VoiceSource>("library");
  const [accountVoices, setAccountVoices] = useState<AccountVoice[]>([]);
  const [accountLoading, setAccountLoading] = useState(true);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(0);
  const [library, setLibrary] = useState<SharedVoicePage | null>(null);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [addedVoiceIds, setAddedVoiceIds] = useState<Map<string, string>>(() => new Map());
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [previewLoadingKey, setPreviewLoadingKey] = useState<string | null>(null);
  const [previewErrorKey, setPreviewErrorKey] = useState<string | null>(null);

  const accountIds = useMemo(() => new Set(accountVoices.map((voice) => voice.id)), [accountVoices]);
  const activeFilterCount = Object.entries(filters).filter(([key, value]) => key !== "sort" && Boolean(value)).length;

  const stopPreview = useCallback(() => {
    previewAttemptRef.current += 1;
    previewCleanupRef.current?.();
    previewCleanupRef.current = null;
    activePreviewRef.current = null;
    const audio = audioRef.current;
    audio?.pause();
    audio?.removeAttribute("src");
    audio?.load();
    setPreviewKey(null);
    setPreviewLoadingKey(null);
    setPreviewErrorKey(null);
  }, []);

  useEffect(() => {
    if (searchInput.trim() === search) return undefined;
    const timeout = window.setTimeout(() => {
      stopPreview();
      setLibraryLoading(true);
      setLibraryError(null);
      setSearch(searchInput.trim());
      setPage(0);
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [search, searchInput, stopPreview]);

  useEffect(() => {
    const controller = new AbortController();
    void getAccountVoices(controller.signal)
      .then(setAccountVoices)
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setAccountError(error instanceof Error ? error.message : "My Voices could not load.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setAccountLoading(false);
      });
    return () => controller.abort();
  }, [refreshKey]);

  useEffect(() => {
    const controller = new AbortController();
    const parameters: SharedVoiceQuery = {
      page,
      pageSize: PAGE_SIZE,
      ...(search ? { search } : {}),
      ...(filters.language ? { language: filters.language } : {}),
      ...(filters.accent ? { accent: filters.accent } : {}),
      ...(filters.gender ? { gender: filters.gender } : {}),
      ...(filters.age ? { age: filters.age } : {}),
      ...(filters.useCase ? { useCase: filters.useCase } : {}),
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.featured ? { featured: true } : {}),
      sort: filters.sort,
    };
    void getSharedVoices(parameters, controller.signal)
      .then(setLibrary)
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setLibrary(null);
          setLibraryError(error instanceof Error ? error.message : "The Voice Library could not load.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLibraryLoading(false);
      });
    return () => controller.abort();
  }, [filters, page, refreshKey, search]);

  useEffect(() => () => {
    previewAttemptRef.current += 1;
    previewCleanupRef.current?.();
    const audio = audioRef.current;
    audio?.pause();
    audio?.removeAttribute("src");
    audio?.load();
  }, []);

  const updateFilter = <Key extends keyof Filters>(key: Key, value: Filters[Key]) => {
    stopPreview();
    setLibraryLoading(true);
    setLibraryError(null);
    setPage(0);
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const clearFilters = () => {
    stopPreview();
    setLibraryLoading(true);
    setLibraryError(null);
    setSearchInput("");
    setSearch("");
    setFilters(EMPTY_FILTERS);
    setPage(0);
  };

  const togglePreview = async (key: string, previewUrl: string | null) => {
    const audio = audioRef.current;
    if (!audio || !previewUrl) return;
    if (activePreviewRef.current === key && !audio.paused) {
      stopPreview();
      return;
    }
    stopPreview();
    const attempt = previewAttemptRef.current;
    activePreviewRef.current = key;
    setPreviewLoadingKey(key);
    const isCurrent = () => previewAttemptRef.current === attempt && activePreviewRef.current === key;
    const onPlaying = () => {
      if (!isCurrent()) return;
      setPreviewLoadingKey(null);
      setPreviewKey(key);
    };
    const onPause = () => {
      if (isCurrent()) setPreviewKey(null);
    };
    const onEnded = () => {
      if (isCurrent()) stopPreview();
    };
    const onError = () => {
      if (!isCurrent()) return;
      setPreviewLoadingKey(null);
      setPreviewKey(null);
      setPreviewErrorKey(key);
    };
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    previewCleanupRef.current = () => {
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
    audio.src = previewProxyUrl(previewUrl);
    audio.load();
    try {
      await audio.play();
    } catch {
      if (isCurrent()) {
        setPreviewLoadingKey(null);
        setPreviewErrorKey(key);
      }
    }
  };

  const copyVoiceId = async (voiceId: string) => {
    try {
      await copyText(voiceId);
      onNotice("success", "Voice ID copied.");
    } catch {
      onNotice("error", "The Voice ID could not be copied. Select it from the settings field instead.");
    }
  };

  const addAndUse = async (voice: SharedVoice) => {
    if (voiceMutationRef.current) return;
    const key = sharedKey(voice);
    const availableVoiceId = addedVoiceIds.get(key) ?? (accountIds.has(voice.voiceId) ? voice.voiceId : null);
    voiceMutationRef.current = true;
    setAddingKey(key);
    try {
      if (availableVoiceId) {
        onSelect({
          id: availableVoiceId,
          name: voice.name,
          description: voice.description,
          category: voice.category,
          previewUrl: voice.previewUrl,
          labels: {},
        });
        onNotice("success", `${voice.name} is ready in the recipe.`);
        return;
      }
      const added = await addSharedVoice(voice);
      setAddedVoiceIds((current) => new Map(current).set(key, added.id));
      setAccountVoices((current) => current.some((item) => item.id === added.id) ? current : [added, ...current]);
      onSelect(added);
      onNotice("success", `${voice.name} was added to ElevenLabs and selected.`);
    } catch (error) {
      onNotice("error", error instanceof Error ? error.message : "The voice could not be added.");
    } finally {
      voiceMutationRef.current = false;
      setAddingKey(null);
    }
  };

  const selectAccountVoice = (voice: AccountVoice) => {
    if (voiceMutationRef.current) return;
    onSelect(voice);
  };

  const renderPreviewButton = (key: string, name: string, previewUrl: string | null) => (
    <button
      className={styles.secondaryButton}
      type="button"
      disabled={!previewUrl}
      aria-label={previewUrl ? `${previewKey === key ? "Pause" : "Play"} ${name} preview` : `${name} has no preview`}
      onClick={() => void togglePreview(key, previewUrl)}
    >
      {previewLoadingKey === key ? "Loading…" : previewKey === key ? "Pause" : previewUrl ? "▶ Preview" : "No preview"}
    </button>
  );

  const refreshVoices = () => {
    stopPreview();
    setAccountLoading(true);
    setAccountError(null);
    setLibraryLoading(true);
    setLibraryError(null);
    setRefreshKey((value) => value + 1);
  };

  const changePage = (nextPage: number) => {
    stopPreview();
    setLibraryLoading(true);
    setLibraryError(null);
    setPage(nextPage);
  };

  const changeSource = (nextSource: VoiceSource) => {
    stopPreview();
    setSource(nextSource);
  };

  return (
    <section className={styles.section} id="voices" aria-labelledby="voices-heading">
      <div className={styles.sectionHeading}>
        <div><span className={styles.step}>01 · Voice</span><h2 id="voices-heading">Find a voice worth testing</h2></div>
        {selectedVoiceId ? <span className={styles.successBadge}>Voice selected</span> : <span className={styles.neutralBadge}>Choose a voice</span>}
      </div>

      <div className={styles.tabs} aria-label="Voice source">
        <button type="button" aria-pressed={source === "library"} className={source === "library" ? styles.activeTab : ""} onClick={() => changeSource("library")}>Shared Library</button>
        <button type="button" aria-pressed={source === "account"} className={source === "account" ? styles.activeTab : ""} onClick={() => changeSource("account")}>My Voices <span>{accountVoices.length}</span></button>
      </div>

      {source === "library" ? (
        <div className={styles.browserPanel}>
          <div className={styles.searchRow}>
            <label className={styles.searchField}>
              <span className={styles.srOnly}>Search Shared Voice Library</span>
              <input value={searchInput} onChange={(event) => setSearchInput(event.currentTarget.value)} placeholder="Search names, accents, or styles" />
            </label>
            <button type="button" className={`${styles.featuredButton} ${filters.featured ? styles.featuredButtonActive : ""}`} aria-pressed={filters.featured} onClick={() => updateFilter("featured", !filters.featured)}>★ Featured</button>
          </div>
          <div className={styles.filters} aria-label="Shared Voice Library filters">
            <span className={styles.filterLabel}>Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}</span>
            <SelectFilter label="Language" value={filters.language} onChange={(value) => updateFilter("language", value)} options={[["es", "Spanish"], ["en", "English"], ["fr", "French"], ["de", "German"], ["it", "Italian"], ["pt", "Portuguese"]]} />
            <SelectFilter label="Accent" value={filters.accent} onChange={(value) => updateFilter("accent", value)} options={[["mexican", "Mexican"], ["latin american", "Latin American"], ["castilian", "Castilian"], ["american", "American"], ["british", "British"]]} />
            <SelectFilter label="Gender" value={filters.gender} onChange={(value) => updateFilter("gender", value)} options={[["female", "Female"], ["male", "Male"], ["neutral", "Neutral"]]} />
            <SelectFilter label="Age" value={filters.age} onChange={(value) => updateFilter("age", value)} options={[["young", "Young"], ["middle aged", "Middle aged"], ["old", "Older"]]} />
            <SelectFilter label="Use" value={filters.useCase} onChange={(value) => updateFilter("useCase", value)} options={[["conversational", "Conversational"], ["narrative_story", "Narration"], ["characters_animation", "Characters"], ["social_media", "Social media"]]} />
            <SelectFilter label="Category" value={filters.category} onChange={(value) => updateFilter("category", value)} options={[["professional", "Professional"], ["famous", "Famous"], ["high_quality", "High quality"]]} />
            <SelectFilter label="Sort" value={filters.sort} includeAny={false} onChange={(value) => updateFilter("sort", value)} options={[["trending", "Trending"], ["cloned_by_count", "Popular"], ["usage_character_count_1y", "Most used"], ["created_date", "Newest"]]} />
            {(activeFilterCount > 0 || search) ? <button type="button" className={styles.textButton} onClick={clearFilters}>Clear</button> : null}
          </div>

          <div className={styles.resultLine} aria-live="polite">
            {libraryLoading ? "Loading voices…" : libraryError ? "Voice Library unavailable" : library?.totalCount == null ? `${library?.voices.length ?? 0} voices on this page` : `${library.totalCount.toLocaleString()} voices`}
          </div>
          {libraryError ? <div className={styles.inlineError}><p>{libraryError}</p><button type="button" className={styles.secondaryButton} onClick={refreshVoices}>Try again</button></div> : null}
          {!libraryLoading && !libraryError && library?.voices.length === 0 ? <div className={styles.empty}>No voices match those filters.</div> : null}
          {libraryLoading ? <div className={styles.voiceGrid}>{Array.from({ length: 6 }, (_, index) => <div className={styles.voiceSkeleton} key={index} />)}</div> : null}
          {!libraryLoading && !libraryError && library ? (
            <div className={styles.voiceGrid}>
              {library.voices.map((voice) => {
                const key = sharedKey(voice);
                const availableVoiceId = addedVoiceIds.get(key) ?? (accountIds.has(voice.voiceId) ? voice.voiceId : null);
                const selected = availableVoiceId !== null && selectedVoiceId === availableVoiceId;
                return (
                  <article className={`${styles.voiceCard} ${selected ? styles.selectedCard : ""}`} key={key}>
                    <div className={styles.voiceHeading}><span className={styles.avatar}>{voice.name.slice(0, 1).toLocaleUpperCase()}</span><div><h3>{voice.name}</h3><p>{voice.category || "Shared voice"}</p></div>{voice.featured ? <span className={styles.featuredBadge}>★</span> : null}</div>
                    <p className={styles.voiceDescription}>{voice.description || "Listen to the official ElevenLabs sample."}</p>
                    <div className={styles.tags}>{voiceTags(voice).map((tag, index) => <span key={`${tag}-${index}`}>{tag}</span>)}</div>
                    <div className={styles.voiceMeta}>
                      {voice.rate != null && voice.rate !== 1 ? <span>×{voice.rate} credits</span> : null}
                      {!voice.freeUsersAllowed ? <span>Paid plan</span> : null}
                      {voice.liveModerationEnabled ? <span>Moderated</span> : null}
                    </div>
                    <div className={styles.cardActions}>
                      {renderPreviewButton(key, voice.name, voice.previewUrl)}
                      <button type="button" className={styles.iconButton} aria-label={`Copy ${voice.name} Voice ID`} title="Copy Voice ID" onClick={() => void copyVoiceId(voice.voiceId)}>Copy ID</button>
                      <button type="button" className={styles.primaryButton} disabled={selected || addingKey !== null} onClick={() => void addAndUse(voice)}>{addingKey === key ? "Adding…" : selected ? "Selected" : availableVoiceId ? "Use" : "Add & use"}</button>
                    </div>
                    {previewErrorKey === key ? <p className={styles.fieldError}>That preview could not play.</p> : null}
                  </article>
                );
              })}
            </div>
          ) : null}
          {library && (library.page > 0 || library.hasMore) ? <div className={styles.pagination}><button type="button" className={styles.secondaryButton} disabled={library.page <= 0} onClick={() => changePage(Math.max(0, library.page - 1))}>← Previous</button><span>Page {library.page + 1}</span><button type="button" className={styles.secondaryButton} disabled={!library.hasMore} onClick={() => changePage(library.page + 1)}>Next →</button></div> : null}
        </div>
      ) : (
        <div className={styles.browserPanel}>
          <div className={styles.resultLine}>{accountLoading ? "Loading My Voices…" : `${accountVoices.length} voices in your account`}</div>
          {accountError ? <div className={styles.inlineError}><p>{accountError}</p><button type="button" className={styles.secondaryButton} onClick={refreshVoices}>Try again</button></div> : null}
          {!accountLoading && !accountError && accountVoices.length === 0 ? <div className={styles.empty}>Your ElevenLabs account has no available voices yet.</div> : null}
          <div className={styles.voiceGrid}>
            {accountVoices.map((voice) => {
              const key = `account:${voice.id}`;
              return <article className={`${styles.voiceCard} ${selectedVoiceId === voice.id ? styles.selectedCard : ""}`} key={voice.id}>
                <div className={styles.voiceHeading}><span className={styles.avatar}>{voice.name.slice(0, 1).toLocaleUpperCase()}</span><div><h3>{voice.name}</h3><p>{voice.category || "Account voice"}</p></div></div>
                <p className={styles.voiceDescription}>{voice.description || "Available in your ElevenLabs account."}</p>
                <div className={styles.tags}>{Object.values(voice.labels).filter(Boolean).slice(0, 5).map((tag, index) => <span key={`${tag}-${index}`}>{tag}</span>)}</div>
                <div className={styles.cardActions}>{renderPreviewButton(key, voice.name, voice.previewUrl)}<button type="button" className={styles.iconButton} onClick={() => void copyVoiceId(voice.id)}>Copy ID</button><button type="button" className={styles.primaryButton} disabled={selectedVoiceId === voice.id || addingKey !== null} onClick={() => selectAccountVoice(voice)}>{selectedVoiceId === voice.id ? "Selected" : "Use"}</button></div>
              </article>;
            })}
          </div>
        </div>
      )}

      <audio ref={audioRef} preload="none" />
    </section>
  );
}
