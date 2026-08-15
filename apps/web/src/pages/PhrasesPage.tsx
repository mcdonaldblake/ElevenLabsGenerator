import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronDown,
  Edit3,
  FileStack,
  Headphones,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { useDeferredValue, useEffect, useState } from "react";
import { api, isServerUnavailable } from "../lib/api";
import { formatNumber } from "../lib/format";
import { mockPhrasePage } from "../lib/mock-data";
import type { AudioStatus, Phrase, PhraseDecision, PhrasePage } from "../types";
import { Badge, Button, Card, EmptyState, Field, Modal, PageHeader, SearchInput, cx } from "../components/ui";

const PAGE_SIZE = 25;

type PhraseFilters = {
  search: string;
  decision: "all" | PhraseDecision;
  audioStatus: "all" | AudioStatus;
};

type PhrasesPageProps = {
  projectId: string;
  isDemoMode: boolean;
  onServerUnavailable: () => void;
  notify: (tone: "success" | "error" | "info", title: string, detail: string) => void;
};

export function PhrasesPage({ projectId, isDemoMode, onServerUnavailable, notify }: PhrasesPageProps) {
  const [filters, setFilters] = useState<PhraseFilters>({ search: "", decision: "all", audioStatus: "all" });
  const deferredSearch = useDeferredValue(filters.search);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PhrasePage>(() => isDemoMode ? mockPhrasePage({ page: 1, pageSize: PAGE_SIZE, search: "", decision: "all", audioStatus: "all" }) : { items: [], page: 1, pageSize: PAGE_SIZE, total: 0 });
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Phrase | null>(null);
  const [editDraft, setEditDraft] = useState({ displayText: "", synthesisText: "", groupCode: "", category: "", tone: "", englishMeaning: "", notes: "" });

  useEffect(() => setPage(1), [deferredSearch, filters.audioStatus, filters.decision]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const next = isDemoMode
          ? mockPhrasePage({ page, pageSize: PAGE_SIZE, search: deferredSearch, decision: filters.decision, audioStatus: filters.audioStatus })
          : await api.phrases({
              projectId,
              page,
              pageSize: PAGE_SIZE,
              ...(deferredSearch ? { search: deferredSearch } : {}),
              ...(filters.decision !== "all" ? { decision: filters.decision } : {}),
              ...(filters.audioStatus !== "all" ? { audioStatus: filters.audioStatus } : {}),
            });
        if (!cancelled) {
          setData(next);
          setSelected(new Set());
        }
      } catch (error) {
        if (!cancelled) {
          if (isServerUnavailable(error)) {
            onServerUnavailable();
            setData(mockPhrasePage({ page, pageSize: PAGE_SIZE, search: deferredSearch, decision: filters.decision, audioStatus: filters.audioStatus }));
          } else {
            notify("error", "Phrase library could not load", error instanceof Error ? error.message : "Please try again.");
            setData({ items: [], page, pageSize: PAGE_SIZE, total: 0 });
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [deferredSearch, filters.audioStatus, filters.decision, isDemoMode, onServerUnavailable, page, projectId]);

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const pageIds = data.items.map((phrase) => phrase.id);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  const updateRows = (phraseIds: Set<string>, nextDecision: PhraseDecision) => {
    setData((current) => ({
      ...current,
      items: current.items.map((phrase) => phraseIds.has(phrase.id) ? { ...phrase, decision: nextDecision } : phrase),
    }));
  };

  const reviewSelected = async (nextDecision: PhraseDecision) => {
    if (selected.size === 0) return;
    const previous = data;
    const ids = new Set(selected);
    updateRows(ids, nextDecision);
    setSelected(new Set());
    try {
      if (!isDemoMode) await api.bulkReview(Array.from(ids), nextDecision);
      notify("success", `${formatNumber(ids.size)} phrases updated`, nextDecision === "kept" ? "They remain eligible for audio production and are marked to keep." : nextDecision === "discarded" ? "They will stay out of production and exports." : "They are pending and remain eligible for audio production.");
    } catch (error) {
      setData(previous);
      notify("error", "Bulk update did not save", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const reviewOne = async (phrase: Phrase, nextDecision: PhraseDecision) => {
    const previous = data;
    updateRows(new Set([phrase.id]), nextDecision);
    try {
      if (!isDemoMode) await api.reviewPhrase(phrase.id, nextDecision);
    } catch (error) {
      setData(previous);
      notify("error", "Decision did not save", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const openEditor = (phrase: Phrase) => {
    setEditing(phrase);
    setEditDraft({
      displayText: phrase.displayText,
      synthesisText: phrase.synthesisText ?? "",
      groupCode: phrase.groupCode,
      category: phrase.category,
      tone: phrase.tone,
      englishMeaning: phrase.englishMeaning,
      notes: phrase.notes,
    });
  };

  const saveEdit = async () => {
    if (!editing || !editDraft.displayText.trim()) return;
    const nextPhrase = {
      ...editing,
      ...editDraft,
      synthesisText: editDraft.synthesisText.trim() || null,
      displayText: editDraft.displayText.trim(),
      wordCount: editDraft.displayText.trim().split(/\s+/).length,
      characterCount: editDraft.displayText.trim().length,
    };
    const previous = data;
    setData((current) => ({ ...current, items: current.items.map((phrase) => phrase.id === editing.id ? nextPhrase : phrase) }));
    setEditing(null);
    try {
      if (!isDemoMode) {
        await api.updatePhrase(editing.id, {
          displayText: nextPhrase.displayText,
          synthesisText: nextPhrase.synthesisText,
          groupCode: nextPhrase.groupCode,
          category: nextPhrase.category,
          tone: nextPhrase.tone,
          englishMeaning: nextPhrase.englishMeaning,
          notes: nextPhrase.notes,
        });
      }
      notify("success", "Phrase saved", "The edited display and synthesis text remain separate.");
    } catch (error) {
      setData(previous);
      notify("error", "Edit did not save", error instanceof Error ? error.message : "Please try again.");
    }
  };

  return (
    <div className="page-stack phrases-page">
      <PageHeader
        eyebrow="Step 2 of 4"
        title="Phrase library"
        description="Clean up wording or make optional early decisions. Pending and kept phrases can both move to audio; discarded phrases are excluded."
        actions={<Badge tone="neutral">{formatNumber(data.total)} matching phrases</Badge>}
      />

      <Card className="filter-card">
        <SearchInput
          icon={<Search size={18} />}
          value={filters.search}
          onChange={(event) => setFilters((current) => ({ ...current, search: event.currentTarget.value }))}
          placeholder="Search phrase, ID, group, or category…"
          aria-label="Search phrase library"
        />
        <label className="compact-select"><SlidersHorizontal size={16} /><select aria-label="Filter by decision" value={filters.decision} onChange={(event) => setFilters((current) => ({ ...current, decision: event.currentTarget.value as PhraseFilters["decision"] }))}><option value="all">All decisions</option><option value="pending">Pending</option><option value="kept">Kept</option><option value="discarded">Discarded</option></select><ChevronDown size={15} /></label>
          <label className="compact-select"><Headphones size={16} /><select aria-label="Filter by audio status" value={filters.audioStatus} onChange={(event) => setFilters((current) => ({ ...current, audioStatus: event.currentTarget.value as PhraseFilters["audioStatus"] }))}><option value="all">All audio</option><option value="none">No audio</option><option value="queued">Needs review</option><option value="ready">Primary selected</option><option value="failed">No primary</option></select><ChevronDown size={15} /></label>
        {(filters.search || filters.decision !== "all" || filters.audioStatus !== "all") ? <Button variant="ghost" size="sm" onClick={() => setFilters({ search: "", decision: "all", audioStatus: "all" })}><X size={15} /> Clear</Button> : null}
      </Card>

      <Card className="phrase-table-card">
        <div className="selection-bar">
          <span>{selected.size > 0 ? <><strong>{formatNumber(selected.size)}</strong> selected</> : "Select rows for a bulk decision"}</span>
          <div className="button-row">
            <Button size="sm" variant="secondary" disabled={selected.size === 0} onClick={() => void reviewSelected("pending")}><RotateCcw size={15} /> Reset</Button>
            <Button size="sm" variant="danger" disabled={selected.size === 0} onClick={() => void reviewSelected("discarded")}><Trash2 size={15} /> Discard</Button>
            <Button size="sm" disabled={selected.size === 0} onClick={() => void reviewSelected("kept")}><CheckCheck size={15} /> Keep</Button>
          </div>
        </div>
        {data.items.length > 0 ? (
          <div className={cx("table-scroll", loading && "is-loading")} aria-busy={loading}>
            <table className="data-table phrase-table">
              <thead><tr><th className="checkbox-column"><input type="checkbox" checked={allSelected} onChange={(event) => setSelected(event.currentTarget.checked ? new Set(pageIds) : new Set())} aria-label="Select all phrases on this page" /></th><th>Phrase</th><th>Group</th><th>Decision</th><th>Audio</th><th className="actions-column">Actions</th></tr></thead>
              <tbody>
                {data.items.map((phrase) => (
                  <tr key={phrase.id} className={cx(selected.has(phrase.id) && "is-selected", phrase.decision === "discarded" && "is-muted")}>
                    <td className="checkbox-column"><input type="checkbox" checked={selected.has(phrase.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.currentTarget.checked) next.add(phrase.id); else next.delete(phrase.id); return next; })} aria-label={`Select ${phrase.displayText}`} /></td>
                    <td className="phrase-cell"><strong lang="es">{phrase.displayText}</strong><span>{phrase.externalId || `${phrase.sourceFile} · row ${phrase.sourceRow}`} · {phrase.wordCount} words</span></td>
                    <td><span className="group-code">{phrase.groupCode || "ungrouped"}</span>{phrase.category || phrase.tone ? <small className="cell-meta">{[phrase.category, phrase.tone].filter(Boolean).join(" · ")}</small> : null}</td>
                    <td><DecisionBadge decision={phrase.decision} /></td>
                    <td><AudioBadge status={phrase.audioStatus} takeCount={phrase.takeCount} /></td>
                    <td className="row-actions">
                      <button type="button" onClick={() => void reviewOne(phrase, "kept")} className={cx(phrase.decision === "kept" && "is-active")} aria-label={`Keep ${phrase.displayText}`} title="Keep"><Check size={17} /></button>
                      <button type="button" onClick={() => void reviewOne(phrase, "discarded")} className={cx(phrase.decision === "discarded" && "is-active-danger")} aria-label={`Discard ${phrase.displayText}`} title="Discard"><X size={17} /></button>
                      <button type="button" onClick={() => openEditor(phrase)} aria-label={`Edit ${phrase.displayText}`} title="Edit"><Edit3 size={16} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={<FileStack />} title="No phrases match" description="Try clearing a filter or import another phrase batch." />
        )}
        <div className="pagination">
          <span>Page {page} of {totalPages} · {formatNumber(data.total)} results</span>
          <div><Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ArrowLeft size={15} /> Previous</Button><Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next <ArrowRight size={15} /></Button></div>
        </div>
      </Card>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title="Edit phrase" description="Display text is what the user sees. Synthesis text is optional and used only for the voice provider.">
        <div className="modal__body edit-form">
          <Field label="Display text"><textarea rows={3} value={editDraft.displayText} lang="es" onChange={(event) => setEditDraft((current) => ({ ...current, displayText: event.currentTarget.value }))} /></Field>
          <Field label="Synthesis text" hint="Leave blank to speak the display text exactly."><textarea rows={3} value={editDraft.synthesisText} lang="es" onChange={(event) => setEditDraft((current) => ({ ...current, synthesisText: event.currentTarget.value }))} /></Field>
          <div className="two-column-fields"><Field label="Group code"><input value={editDraft.groupCode} onChange={(event) => setEditDraft((current) => ({ ...current, groupCode: event.currentTarget.value }))} /></Field><Field label="Category"><input value={editDraft.category} onChange={(event) => setEditDraft((current) => ({ ...current, category: event.currentTarget.value }))} /></Field></div>
          <div className="two-column-fields"><Field label="Tone"><input value={editDraft.tone} onChange={(event) => setEditDraft((current) => ({ ...current, tone: event.currentTarget.value }))} /></Field><Field label="English meaning"><input value={editDraft.englishMeaning} onChange={(event) => setEditDraft((current) => ({ ...current, englishMeaning: event.currentTarget.value }))} /></Field></div>
          <Field label="Notes"><textarea rows={2} value={editDraft.notes} onChange={(event) => setEditDraft((current) => ({ ...current, notes: event.currentTarget.value }))} /></Field>
        </div>
        <div className="modal__footer"><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={() => void saveEdit()} disabled={!editDraft.displayText.trim()}>Save phrase</Button></div>
      </Modal>
    </div>
  );
}

function DecisionBadge({ decision }: { decision: PhraseDecision }) {
  if (decision === "kept") return <Badge tone="success"><Check size={13} /> Kept</Badge>;
  if (decision === "discarded") return <Badge tone="danger"><X size={13} /> Discarded</Badge>;
  return <Badge tone="warning">Pending</Badge>;
}

function AudioBadge({ status, takeCount }: { status: AudioStatus; takeCount: number }) {
  if (status === "ready") return <Badge tone="success"><Headphones size={13} /> Primary selected</Badge>;
  if (status === "queued") return <Badge tone="orange">{takeCount > 0 ? `${takeCount} needs review` : "Processing"}</Badge>;
  if (status === "failed") return <Badge tone="warning">No primary</Badge>;
  return <span className="muted">Not made</span>;
}
