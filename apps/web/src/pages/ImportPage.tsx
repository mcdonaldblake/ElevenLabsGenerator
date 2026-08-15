import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  FileJson2,
  FileSpreadsheet,
  FileText,
  RotateCcw,
  ShieldCheck,
  UploadCloud,
  XCircle,
} from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { api, isServerUnavailable } from "../lib/api";
import { formatBytes, formatNumber } from "../lib/format";
import { parsePhraseFile } from "../lib/import-parser";
import type { AppPage, ImportPreview, ImportResult } from "../types";
import { Badge, Button, Card, EmptyState, PageHeader, ProgressBar, cx } from "../components/ui";

const ACCEPTED_EXTENSIONS = new Set(["csv", "tsv", "txt", "json"]);

type ImportPageProps = {
  projectId: string;
  isDemoMode: boolean;
  onServerUnavailable: () => void;
  onNavigate: (page: AppPage) => void;
  notify: (tone: "success" | "error" | "info", title: string, detail: string) => void;
};

export function ImportPage({ projectId, isDemoMode, onServerUnavailable, onNavigate, notify }: ImportPageProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");

  const inspectFile = async (nextFile: File) => {
    const extension = nextFile.name.split(".").pop()?.toLocaleLowerCase("en-US") ?? "";
    if (!ACCEPTED_EXTENSIONS.has(extension)) {
      setError("Choose a CSV, TSV, TXT, or JSON file.");
      return;
    }
    setFile(nextFile);
    setPreview(null);
    setResult(null);
    setError("");
    setLoading(true);
    try {
      if (isDemoMode) {
        setPreview(await parsePhraseFile(nextFile));
      } else {
        try {
          setPreview(await api.previewImport(nextFile, projectId));
        } catch (previewError) {
          if (!isServerUnavailable(previewError)) throw previewError;
          onServerUnavailable();
          setPreview(await parsePhraseFile(nextFile));
          notify("info", "Local preview used", "The file was checked in this browser because the local server could not respond.");
        }
      }
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "This file could not be read.");
    } finally {
      setLoading(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped) void inspectFile(dropped);
  };

  const commit = async () => {
    if (!file || !preview || preview.validRows === 0) return;
    if (isDemoMode) {
      notify("info", "Reconnect to import", "The file preview is safe to inspect here, but committing a phrase batch requires the local server.");
      return;
    }
    setCommitting(true);
    try {
      const imported = await api.commitImport(file, projectId);
      setResult(imported);
      notify(
        "success",
        `${formatNumber(imported.importedCount)} phrases imported`,
        imported.duplicateCount > 0 ? `${formatNumber(imported.duplicateCount)} duplicates were safely skipped.` : "The batch is ready for review.",
      );
    } catch (commitError) {
      notify("error", "Import did not finish", commitError instanceof Error ? commitError.message : "Please try again.");
    } finally {
      setCommitting(false);
    }
  };

  const reset = () => {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError("");
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="page-stack import-page">
      <PageHeader
        eyebrow="Step 1 of 4"
        title="Import phrases"
        description="Bring your own phrase batch. Nothing is written until you inspect the preview and confirm it."
        actions={preview ? <Button variant="ghost" onClick={reset}><RotateCcw size={16} /> Start over</Button> : undefined}
      />

      {result ? (
        <Card className="success-panel">
          <div className="success-panel__icon"><Check size={31} /></div>
          <div>
            <p className="eyebrow">Import complete</p>
            <h2>{formatNumber(result.importedCount)} phrases are ready to review.</h2>
            <p>{result.duplicateCount > 0 ? `${formatNumber(result.duplicateCount)} duplicates were skipped. ` : ""}Your original file remains unchanged.</p>
            <div className="button-row">
              <Button size="lg" onClick={() => onNavigate("phrases")}>Open phrase library <ArrowRight size={17} /></Button>
              <Button size="lg" variant="secondary" onClick={reset}>Import another file</Button>
            </div>
          </div>
        </Card>
      ) : (
        <>
          {!preview ? (
            <Card className="upload-card">
              <div
                className={cx("drop-zone", dragging && "is-dragging", error && "has-error")}
                onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
                }}
                onDrop={onDrop}
                role="button"
                tabIndex={0}
                onClick={() => inputRef.current?.click()}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    inputRef.current?.click();
                  }
                }}
                aria-label="Choose or drop a phrase file"
              >
                <input
                  ref={inputRef}
                  type="file"
                  hidden
                  accept=".csv,.tsv,.txt,.json,text/csv,text/tab-separated-values,text/plain,application/json"
                  onChange={(event) => {
                    const selected = event.currentTarget.files?.[0];
                    if (selected) void inspectFile(selected);
                  }}
                />
                <div className="drop-zone__icon"><UploadCloud size={31} /></div>
                <h2>{loading ? "Reading your file…" : "Drop a phrase file here"}</h2>
                <p>or choose a file from this computer</p>
                <Button type="button" disabled={loading}>{loading ? "Checking rows…" : "Choose file"}</Button>
                {loading ? <ProgressBar value={64} label="Reading phrase file" /> : null}
                {error ? <span className="drop-zone__error"><XCircle size={16} /> {error}</span> : null}
              </div>
              <div className="format-row" aria-label="Supported file formats">
                <Format icon={<FileSpreadsheet />} name="CSV / TSV" detail="Use a text or phrase column" />
                <Format icon={<FileText />} name="TXT" detail="One phrase per line" />
                <Format icon={<FileJson2 />} name="JSON" detail="Strings or phrase objects" />
              </div>
            </Card>
          ) : (
            <>
              <Card className="file-summary-card">
                <div className="file-summary-card__identity">
                  <div className="file-icon file-icon--large"><FileSpreadsheet size={22} /></div>
                  <div><strong>{preview.fileName}</strong><span>{file ? formatBytes(file.size) : preview.fileType} · {preview.fileType}</span></div>
                </div>
                <Badge tone="success"><ShieldCheck size={14} /> Checked</Badge>
              </Card>

              <section className="import-summary-grid" aria-label="Import preview summary">
                <SummaryCard label="Rows found" value={preview.totalRows} tone="neutral" icon={<FileText />} />
                <SummaryCard label="Ready to import" value={preview.validRows} tone="success" icon={<CheckCircle2 />} />
                <SummaryCard label="Duplicates" value={preview.duplicateRows} tone="warning" icon={<AlertTriangle />} />
                <SummaryCard label="Needs attention" value={preview.invalidRows} tone="danger" icon={<XCircle />} />
              </section>

              {preview.warnings.length > 0 ? (
                <div className="inline-alert inline-alert--warning" role="status">
                  <AlertTriangle size={18} />
                  <div><strong>Check before importing</strong>{preview.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>
                </div>
              ) : null}

              <Card className="preview-card">
                <div className="card-heading">
                  <div><p className="eyebrow">Preview</p><h2>First {Math.min(preview.rows.length, 20)} rows</h2></div>
                  {preview.detectedFields.length > 0 ? <span className="detected-fields">Detected: {preview.detectedFields.slice(0, 4).join(", ")}</span> : null}
                </div>
                {preview.rows.length > 0 ? (
                  <div className="table-scroll">
                    <table className="data-table import-table">
                      <thead><tr><th>Row</th><th>Phrase</th><th>Group</th><th>Category</th><th>Status</th></tr></thead>
                      <tbody>
                        {preview.rows.slice(0, 20).map((row) => (
                          <tr key={`${row.sourceRow}-${row.displayText}`} className={row.status !== "valid" ? `row--${row.status}` : undefined}>
                            <td className="mono-cell">{row.sourceRow}</td>
                            <td><strong lang="es">{row.displayText || "Empty row"}</strong>{row.externalId ? <small>{row.externalId}</small> : null}</td>
                            <td>{row.groupCode || <span className="muted">—</span>}</td>
                            <td>{row.category || <span className="muted">—</span>}</td>
                            <td><ImportStatus status={row.status} issue={row.issue} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState icon={<FileText />} title="No phrases found" description="Check the file format and make sure at least one row contains phrase text." />
                )}
                {preview.rows.length > 20 ? <p className="table-footnote">Showing 20 of {formatNumber(preview.totalRows)} rows. The entire file will be imported.</p> : null}
              </Card>

              <Card className="commit-bar">
                <div>
                  <ShieldCheck size={21} />
                  <span><strong>No generated text.</strong> Voice Foundry imports exactly the valid phrases shown in your file.</span>
                </div>
                  <Button size="lg" loading={committing} disabled={preview.validRows === 0} onClick={() => void commit()}>
                  {isDemoMode ? "Reconnect to import" : `Import ${formatNumber(preview.validRows)} phrases`} <ArrowRight size={17} />
                </Button>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Format({ icon, name, detail }: { icon: React.ReactNode; name: string; detail: string }) {
  return <div className="format-item"><span aria-hidden="true">{icon}</span><div><strong>{name}</strong><small>{detail}</small></div></div>;
}

function SummaryCard({ label, value, tone, icon }: {
  label: string;
  value: number;
  tone: "neutral" | "success" | "warning" | "danger";
  icon: React.ReactNode;
}) {
  return <Card className={cx("import-summary", `import-summary--${tone}`)}><span aria-hidden="true">{icon}</span><div><strong>{formatNumber(value)}</strong><small>{label}</small></div></Card>;
}

function ImportStatus({ status, issue }: { status: ImportPreview["rows"][number]["status"]; issue: string | null }) {
  if (status === "valid") return <Badge tone="success"><Check size={13} /> Ready</Badge>;
  if (status === "duplicate") return <Badge tone="warning" title={issue ?? "Repeated phrase"}><AlertTriangle size={13} /> Duplicate</Badge>;
  return <Badge tone="danger" title={issue ?? "Invalid row"}><XCircle size={13} /> Fix row</Badge>;
}
