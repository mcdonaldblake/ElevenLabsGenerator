import {
  ArrowRight,
  Check,
  CircleDashed,
  FileCheck2,
  FileStack,
  Headphones,
  PackageCheck,
  Play,
  Sparkles,
  Upload,
} from "lucide-react";
import type { AppPage, DashboardData, Project } from "../types";
import { formatNumber, formatRelativeTime, percent } from "../lib/format";
import { Badge, Button, Card, PageHeader, ProgressBar, Skeleton, cx } from "../components/ui";

type OverviewPageProps = {
  project: Project;
  data: DashboardData;
  loading: boolean;
  onNavigate: (page: AppPage) => void;
};

export function OverviewPage({ project, data, loading, onNavigate }: OverviewPageProps) {
  const reviewed = data.kept + data.discarded;
  const reviewProgress = percent(reviewed, data.imported);
  const audioProgress = percent(data.audioReady, data.kept);
  const exportProgress = percent(data.exportReady, data.kept);
  const batch = data.activeBatch;
  const batchProgress = batch ? percent(batch.completedJobs, batch.totalJobs) : 0;

  return (
    <div className="page-stack overview-page">
      <PageHeader
        eyebrow="Production workspace"
        title={project.name}
        description="Files in. Approved audio out. Every phrase stays traceable along the way."
        actions={
          <Button onClick={() => onNavigate("import")}><Upload size={17} /> Import a batch</Button>
        }
      />

      <section className="overview-hero">
        <div className="overview-hero__copy">
          <Badge tone="orange"><Sparkles size={13} /> Today’s focus</Badge>
          <h2>{data.pending > 0 ? `${formatNumber(data.pending)} phrases are ready for a quick decision.` : "Your phrase library is fully reviewed."}</h2>
          <p>
            {data.pending > 0
              ? "Produce your uploaded pending phrases, then listen quickly and keep only the audio that belongs in the library."
              : "Import another phrase file or move non-discarded phrases through audio production."}
          </p>
          <div className="button-row">
            <Button size="lg" onClick={() => onNavigate(data.pending > 0 ? "phrases" : "import")}>
              {data.pending > 0 ? "Review phrases" : "Import phrases"} <ArrowRight size={17} />
            </Button>
            <Button variant="secondary" size="lg" onClick={() => onNavigate("review")}>
              <Headphones size={17} /> Review audio
            </Button>
          </div>
        </div>
        <div className="overview-hero__meter" aria-label="Phrase review progress">
          <div className="ring-meter" style={{ "--ring-progress": `${reviewProgress * 3.6}deg` } as React.CSSProperties}>
            <div><strong>{reviewProgress}%</strong><span>text reviewed</span></div>
          </div>
          <div className="hero-mini-stat"><span>Kept</span><strong>{formatNumber(data.kept)}</strong></div>
          <div className="hero-mini-stat"><span>Pending</span><strong>{formatNumber(data.pending)}</strong></div>
        </div>
      </section>

      <section className="metric-grid" aria-label="Project totals">
        <MetricCard loading={loading} icon={<FileStack />} label="Imported" value={data.imported} detail="total source phrases" />
        <MetricCard loading={loading} icon={<FileCheck2 />} label="Kept" value={data.kept} detail={`${reviewProgress}% text review complete`} tone="green" />
        <MetricCard loading={loading} icon={<Headphones />} label="Audio ready" value={data.audioReady} detail={`${Math.max(0, data.kept - data.audioReady)} kept phrases remaining`} tone="orange" />
        <MetricCard loading={loading} icon={<PackageCheck />} label="Export ready" value={data.exportReady} detail="with a primary take" tone="navy" />
      </section>

      <div className="overview-grid">
        <Card className="workflow-card">
          <div className="card-heading">
            <div><p className="eyebrow">The production line</p><h2>One clear path to final files</h2></div>
            <Badge tone="neutral">{formatNumber(data.imported)} total</Badge>
          </div>
          <div className="workflow-steps">
            <WorkflowStep
              number="01"
              title="Import"
              detail={`${formatNumber(data.imported)} phrases loaded`}
              progress={data.imported > 0 ? 100 : 0}
              done={data.imported > 0}
              onClick={() => onNavigate("import")}
            />
            <WorkflowStep
              number="02"
              title="Decide"
              detail={`${formatNumber(data.pending)} still need review`}
              progress={reviewProgress}
              done={data.imported > 0 && data.pending === 0}
              onClick={() => onNavigate("phrases")}
            />
            <WorkflowStep
              number="03"
              title="Produce"
              detail={`${formatNumber(data.audioReady)} clips made`}
              progress={audioProgress}
              done={data.kept > 0 && data.audioReady >= data.kept}
              onClick={() => onNavigate("production")}
            />
            <WorkflowStep
              number="04"
              title="Export"
              detail={`${formatNumber(data.exportReady)} assets ready`}
              progress={exportProgress}
              done={data.kept > 0 && data.exportReady >= data.kept}
              onClick={() => onNavigate("exports")}
            />
          </div>
        </Card>

        <Card className="queue-card">
          <div className="card-heading">
            <div><p className="eyebrow">Audio queue</p><h2>{batch ? "First pass in progress" : "No active batch"}</h2></div>
            <span className={cx("pulse-dot", batch?.status === "running" && "is-live")} aria-hidden="true" />
          </div>
          {batch ? (
            <>
              <div className="queue-big-number"><strong>{batch.completedJobs}</strong><span>of {batch.totalJobs} clips</span></div>
              <ProgressBar value={batchProgress} label="Active audio batch" />
              <div className="queue-breakdown">
                <span><i className="queue-key queue-key--done" /> {batch.completedJobs} complete</span>
                <span><i className="queue-key queue-key--active" /> {batch.runningJobs} active</span>
                <span><i className="queue-key" /> {batch.queuedJobs} waiting</span>
              </div>
              <Button variant="secondary" onClick={() => onNavigate("production")}>View production queue <ArrowRight size={16} /></Button>
            </>
          ) : (
            <div className="quiet-state">
              <CircleDashed size={30} />
              <p>Run a calibration after importing phrases and locking a voice profile.</p>
              <Button variant="secondary" onClick={() => onNavigate("production")}>Open production</Button>
            </div>
          )}
        </Card>
      </div>

      <Card className="recent-card">
        <div className="card-heading">
          <div><p className="eyebrow">Recent source files</p><h2>Latest imports</h2></div>
          <Button variant="ghost" size="sm" onClick={() => onNavigate("import")}>Add another <ArrowRight size={15} /></Button>
        </div>
        {data.recentImports.length > 0 ? (
          <div className="recent-list">
            {data.recentImports.map((item) => (
              <div className="recent-item" key={item.id}>
                <div className="file-icon"><FileStack size={18} /></div>
                <div><strong>{item.fileName}</strong><span>{formatNumber(item.importedCount)} phrases · {formatRelativeTime(item.createdAt)}</span></div>
                <Check size={17} aria-label="Import complete" />
              </div>
            ))}
          </div>
        ) : (
          <div className="quiet-state quiet-state--inline"><Play size={22} /><p>Your first import will appear here.</p></div>
        )}
      </Card>
    </div>
  );
}

function MetricCard({ loading, icon, label, value, detail, tone = "cream" }: {
  loading: boolean;
  icon: React.ReactNode;
  label: string;
  value: number;
  detail: string;
  tone?: "cream" | "green" | "orange" | "navy";
}) {
  return (
    <Card className={cx("metric-card", `metric-card--${tone}`)}>
      <div className="metric-card__icon" aria-hidden="true">{icon}</div>
      <div><span>{label}</span>{loading ? <Skeleton className="skeleton--number" /> : <strong>{formatNumber(value)}</strong>}<small>{detail}</small></div>
    </Card>
  );
}

function WorkflowStep({ number, title, detail, progress, done, onClick }: {
  number: string;
  title: string;
  detail: string;
  progress: number;
  done: boolean;
  onClick: () => void;
}) {
  return (
    <button className="workflow-step" type="button" onClick={onClick}>
      <span className={cx("workflow-step__number", done && "is-done")}>{done ? <Check size={16} /> : number}</span>
      <span className="workflow-step__content"><strong>{title}</strong><small>{detail}</small><ProgressBar value={progress} label={`${title} progress`} tone={done ? "green" : "orange"} /></span>
      <ArrowRight size={17} className="workflow-step__arrow" />
    </button>
  );
}
