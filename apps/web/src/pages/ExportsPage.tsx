import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Download,
  FileArchive,
  FileAudio2,
  FileCode2,
  FileJson2,
  FileSpreadsheet,
  FolderCheck,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api, isServerUnavailable } from "../lib/api";
import { formatBytes, formatDate, formatDuration, formatNumber } from "../lib/format";
import { mockExportPreview, mockExports } from "../lib/mock-data";
import type { ExportPreview, ExportRecord } from "../types";
import { Badge, Button, Card, EmptyState, Field, PageHeader, cx } from "../components/ui";

type ExportsPageProps = {
  projectId: string;
  isDemoMode: boolean;
  onServerUnavailable: () => void;
  notify: (tone: "success" | "error" | "info", title: string, detail: string) => void;
};

export function ExportsPage({ projectId, isDemoMode, onServerUnavailable, notify }: ExportsPageProps) {
  const [preview, setPreview] = useState<ExportPreview | null>(null);
  const [exports, setExports] = useState<ExportRecord[]>(() => isDemoMode ? mockExports : []);
  const [label, setLabel] = useState(`Mara audio library · ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date())}`);
  const [previewing, setPreviewing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (isDemoMode) return;
      try {
        const next = await api.exports(projectId);
        if (!cancelled) setExports(next);
      } catch (error) {
        if (!cancelled) {
          if (isServerUnavailable(error)) onServerUnavailable();
          else notify("error", "Export history could not load", error instanceof Error ? error.message : "Please try again.");
        }
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [isDemoMode, notify, onServerUnavailable, projectId]);

  const runPreview = async () => {
    setPreviewing(true);
    try {
      setPreview(isDemoMode ? mockExportPreview : await api.exportPreview(projectId));
    } catch (error) {
      notify("error", "Export check did not finish", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setPreviewing(false);
    }
  };

  const createExport = async () => {
    if (!preview?.canExport || !label.trim()) return;
    if (isDemoMode) {
      notify("info", "Reconnect to create the ZIP", "A real export can only be assembled by the local server from the audio files on this computer.");
      return;
    }
    setCreating(true);
    try {
      const record = await api.createExport(projectId, label.trim());
      setExports((current) => [record, ...current.filter((item) => item.id !== record.id)]);
      notify("success", "Export created", `${formatNumber(record.itemCount)} approved assets were packaged with code and metadata.`);
    } catch (error) {
      notify("error", "Export did not finish", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setCreating(false);
    }
  };

  const downloadExport = async (record: ExportRecord) => {
    if (isDemoMode || downloadingId) return;
    setDownloadingId(record.id);
    try {
      const access = await api.recheckAccess();
      if (access.requiresPairing) return;

      // Let the browser stream the attachment directly; large ZIPs never enter JavaScript memory.
      window.location.assign(api.exportDownloadUrl(record.id));
    } catch (error) {
      if (isServerUnavailable(error)) onServerUnavailable();
      else notify("error", "Download could not start", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="page-stack exports-page">
      <PageHeader
        eyebrow="Final handoff"
        title="Exports"
        description="Package approved audio into stable files, a TypeScript map, metadata, and checksums ready to hardcode in Frase Uno."
        actions={<Badge tone="success"><ShieldCheck size={14} /> Source repository stays untouched</Badge>}
      />

      <Card className="export-builder-card">
        <div className="export-builder-copy">
          <div className="export-package-icon"><PackageCheck size={32} /></div>
          <div><p className="eyebrow">Dry run first</p><h2>Build a production-ready audio package</h2><p>Only kept phrases with exactly one primary audio take are eligible. Existing exports are never overwritten.</p></div>
        </div>
        <div className="export-builder-form">
          <Field label="Export label"><input value={label} onChange={(event) => setLabel(event.currentTarget.value)} /></Field>
          <Button size="lg" loading={previewing} onClick={() => void runPreview()}><RefreshCw size={17} /> Preview export</Button>
        </div>
      </Card>

      {preview ? (
        <div className="export-preview-grid">
          <Card className="export-validation-card">
            <div className="card-heading"><div><p className="eyebrow">Validation report</p><h2>{preview.canExport ? "Ready to package" : "A few things need attention"}</h2></div>{preview.canExport ? <span className="validation-seal"><Check size={20} /></span> : <span className="validation-seal validation-seal--danger"><AlertTriangle size={20} /></span>}</div>
            <div className="export-metrics"><div><strong>{formatNumber(preview.eligibleAssets)}</strong><span>eligible assets</span></div><div><strong>{formatDuration(preview.totalDurationMs)}</strong><span>total audio</span></div><div><strong>{formatBytes(preview.totalBytes)}</strong><span>estimated size</span></div><div><strong>{formatNumber(preview.excludedPhrases)}</strong><span>excluded phrases</span></div></div>
            {preview.errors.length > 0 ? <div className="validation-list validation-list--errors">{preview.errors.map((error) => <div key={error}><AlertTriangle size={16} /><span>{error}</span></div>)}</div> : null}
            {preview.warnings.length > 0 ? <div className="validation-list validation-list--warnings">{preview.warnings.map((warning) => <div key={warning}><AlertTriangle size={16} /><span>{warning}</span></div>)}</div> : null}
            {preview.errors.length === 0 ? <div className="validation-list validation-list--success"><div><CheckCircle2 size={16} /><span>Every included phrase has exactly one primary take.</span></div><div><CheckCircle2 size={16} /><span>File paths, stable IDs, MIME types, and checksums are validated.</span></div><div><CheckCircle2 size={16} /><span>The voice profile snapshot is locked and included.</span></div></div> : null}
            <div className="export-create-row"><span>{isDemoMode ? "Preview only while the server is disconnected." : "The ZIP will be written atomically to the local exports folder."}</span><Button size="lg" loading={creating} disabled={!preview.canExport} onClick={() => void createExport()}><FileArchive size={17} /> {isDemoMode ? "Reconnect to create ZIP" : "Create export ZIP"}</Button></div>
          </Card>

          <Card className="package-contents-card">
            <div className="card-heading"><div><p className="eyebrow">Package contents</p><h2>Ready to hardcode</h2></div></div>
            <div className="package-file-list">
              <PackageFile icon={<FileAudio2 />} title="audio/mara/…" detail={`${formatNumber(preview.eligibleAssets)} stable audio files`} />
              <PackageFile icon={<FileCode2 />} title="audio-map.ts" detail="Typed mapping for direct imports" />
              <PackageFile icon={<FileJson2 />} title="manifest.json" detail="Text, tone, paths, and hashes" />
              <PackageFile icon={<FileSpreadsheet />} title="phrases.csv" detail="Readable phrase inventory" />
              <PackageFile icon={<ShieldCheck />} title="voice-profile.json" detail="Exact locked production recipe" />
            </div>
            {preview.sampleFiles.length > 0 ? <div className="sample-paths"><strong>Sample paths</strong>{preview.sampleFiles.slice(0, 4).map((path) => <code key={path}>{path}</code>)}</div> : null}
          </Card>
        </div>
      ) : null}

      <Card className="export-history-card">
        <div className="card-heading"><div><p className="eyebrow">Local history</p><h2>Previous exports</h2></div><Badge tone="neutral">{exports.length}</Badge></div>
        {exports.length > 0 ? (
          <div className="export-list">
            {exports.map((record) => (
              <div className="export-item" key={record.id}>
                <div className="file-icon file-icon--large"><FolderCheck size={21} /></div>
                <div className="export-item__copy"><strong>{record.label}</strong><span>{formatDate(record.createdAt)} · {formatNumber(record.itemCount)} assets · {formatBytes(record.totalBytes)}</span><code>{record.path || "Local export folder"}</code></div>
                <Badge tone={record.status === "ready" ? "success" : record.status === "failed" ? "danger" : "warning"}>{record.status}</Badge>
                {record.status === "ready" && !isDemoMode ? <Button variant="secondary" loading={downloadingId === record.id} disabled={Boolean(downloadingId)} onClick={() => void downloadExport(record)}><Download size={16} /> Download ZIP</Button> : <Button variant="secondary" disabled><Download size={16} /> Download ZIP</Button>}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={<FileArchive />} title="No exports yet" description="Run a dry-run preview when your approved primary takes are ready." />
        )}
      </Card>
    </div>
  );
}

function PackageFile({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return <div className="package-file"><span aria-hidden="true">{icon}</span><div><strong>{title}</strong><small>{detail}</small></div></div>;
}
