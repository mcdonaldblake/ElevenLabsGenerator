import {
  AudioLines,
  Boxes,
  ChevronsUpDown,
  CirclePlus,
  CloudCog,
  Download,
  Factory,
  FileAudio2,
  Gauge,
  Menu,
  Settings2,
  UploadCloud,
  Volume2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import type { AppPage, HealthStatus, Project } from "../types";
import { Badge, Button, cx } from "./ui";

type NavItem = {
  id: AppPage;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
};

const NAV_ITEMS: NavItem[] = [
  { id: "overview", label: "Overview", shortLabel: "Home", icon: Gauge },
  { id: "import", label: "Import phrases", shortLabel: "Import", icon: UploadCloud },
  { id: "phrases", label: "Phrase library", shortLabel: "Phrases", icon: Boxes },
  { id: "voice", label: "Voice profile", shortLabel: "Voice", icon: Volume2 },
  { id: "production", label: "Production", shortLabel: "Produce", icon: Factory },
  { id: "review", label: "Audio review", shortLabel: "Review", icon: FileAudio2 },
  { id: "exports", label: "Exports", shortLabel: "Exports", icon: Download },
  { id: "settings", label: "Settings & usage", shortLabel: "Settings", icon: Settings2 },
];

type ShellProps = {
  page: AppPage;
  onNavigate: (page: AppPage) => void;
  projects: Project[];
  projectId: string;
  onProjectChange: (projectId: string) => void;
  onCreateProject: () => void;
  health: HealthStatus;
  isDemoMode: boolean;
  isLanConnection: boolean;
  disconnecting: boolean;
  onDisconnectDevice: () => void;
  children: ReactNode;
};

export function Shell({
  page,
  onNavigate,
  projects,
  projectId,
  onProjectChange,
  onCreateProject,
  health,
  isDemoMode,
  isLanConnection,
  disconnecting,
  onDisconnectDevice,
  children,
}: ShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const currentProject = projects.find((project) => project.id === projectId) ?? projects[0];

  const navigate = (destination: AppPage) => {
    onNavigate(destination);
    setMobileOpen(false);
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className={cx("sidebar", mobileOpen && "sidebar--open")}>
        <div className="sidebar__brand">
          <div className="brand-mark" aria-hidden="true">
            <AudioLines size={22} strokeWidth={2.2} />
          </div>
          <div>
            <span>Frase Uno</span>
            <strong>Voice Foundry</strong>
          </div>
          <button className="sidebar__close icon-button" type="button" onClick={() => setMobileOpen(false)} aria-label="Close menu">
            <X size={20} />
          </button>
        </div>

        <div className="project-switcher">
          <label htmlFor="project-select">Current project</label>
          <div className="project-switcher__select">
            <select
              id="project-select"
              value={currentProject?.id ?? ""}
              onChange={(event) => onProjectChange(event.currentTarget.value)}
            >
              {projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
            </select>
            <ChevronsUpDown size={15} aria-hidden="true" />
          </div>
          <button type="button" onClick={onCreateProject}>
            <CirclePlus size={15} /> New project
          </button>
        </div>

        <nav className="primary-nav" aria-label="Main navigation">
          <p>Workspace</p>
          <ul>
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.id}>
                  <button
                    className={cx(page === item.id && "is-active")}
                    type="button"
                    onClick={() => navigate(item.id)}
                    aria-current={page === item.id ? "page" : undefined}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span>{item.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="sidebar__footer">
          <div className="local-status">
            <span className={cx("status-light", health.server === "online" && "status-light--online")} />
            <div>
              <strong>{health.server === "online" ? (isLanConnection ? "Mac connected" : "Local server online") : "Local server offline"}</strong>
              <small>{health.database === "ready" ? (isLanConnection ? "Trusted Wi-Fi session" : "Database ready") : "Using preview workspace"}</small>
            </div>
          </div>
          <p><CloudCog size={15} /> Files stay on this computer</p>
          {isLanConnection ? (
            <button className="device-unpair" type="button" onClick={onDisconnectDevice} disabled={disconnecting}>
              <X size={14} aria-hidden="true" /> {disconnecting ? "Disconnecting…" : "Disconnect this iPhone"}
            </button>
          ) : null}
        </div>
      </aside>

      {mobileOpen ? <button className="sidebar-scrim" type="button" onClick={() => setMobileOpen(false)} aria-label="Close menu" /> : null}

      <div className="workspace">
        <header className="mobile-header">
          <button className="icon-button" type="button" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu size={21} />
          </button>
          <div className="mobile-header__brand"><AudioLines size={18} /> <strong>Voice Foundry</strong></div>
          <Badge tone={health.server === "online" ? "success" : "warning"}>{health.server === "online" ? (isLanConnection ? "Wi-Fi" : "Local") : "Preview"}</Badge>
        </header>

        {isDemoMode ? (
          <div className="demo-banner" role="status">
            <span><strong>Preview workspace</strong> · The local server is not connected, so changes are temporary.</span>
            <Button variant="ghost" size="sm" onClick={() => navigate("settings")}>Connection help</Button>
          </div>
        ) : null}

        <main id="main-content" className="main-content" tabIndex={-1}>{children}</main>

        <nav className="mobile-tabs" aria-label="Mobile navigation">
          {NAV_ITEMS.slice(0, 5).map((item) => {
            const Icon = item.icon;
            return (
              <button
                type="button"
                key={item.id}
                className={cx(page === item.id && "is-active")}
                onClick={() => navigate(item.id)}
                aria-label={item.label}
                aria-current={page === item.id ? "page" : undefined}
              >
                <Icon size={19} /><span>{item.shortLabel}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
