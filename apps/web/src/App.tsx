import { FolderPlus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PairingGate } from "./components/PairingGate";
import { Shell } from "./components/Shell";
import { Button, Card, EmptyState, Field, Modal, ToastViewport } from "./components/ui";
import { ACCESS_REQUIRED_EVENT, ApiRequestError, api, isServerUnavailable, type AccessStatus } from "./lib/api";
import { mockDashboard, mockProjects } from "./lib/mock-data";
import { ExportsPage } from "./pages/ExportsPage";
import { ImportPage } from "./pages/ImportPage";
import { OverviewPage } from "./pages/OverviewPage";
import { PhrasesPage } from "./pages/PhrasesPage";
import { ProductionPage } from "./pages/ProductionPage";
import { ReviewPage } from "./pages/ReviewPage";
import { SettingsPage } from "./pages/SettingsPage";
import { VoiceProfilePage } from "./pages/VoiceProfilePage";
import type { AppPage, DashboardData, HealthStatus, Project, ToastMessage } from "./types";

const VALID_PAGES = new Set<AppPage>([
  "overview",
  "import",
  "phrases",
  "voice",
  "production",
  "review",
  "exports",
  "settings",
]);

const OFFLINE_HEALTH: HealthStatus = {
  ok: false,
  server: "offline",
  database: "unavailable",
  providerMode: "unconfigured",
  version: "preview",
};

const LAST_PAGE_KEY = "voice-foundry-last-page-v1";
const LAST_PROJECT_KEY = "voice-foundry-last-project-v1";
const EMPTY_DASHBOARD: DashboardData = { imported: 0, kept: 0, discarded: 0, pending: 0, audioReady: 0, exportReady: 0, activeBatch: null, recentImports: [] };

function initialPage(): AppPage {
  const hash = window.location.hash.replace(/^#\/?/, "") as AppPage;
  if (VALID_PAGES.has(hash)) return hash;
  const stored = localStorage.getItem(LAST_PAGE_KEY) as AppPage | null;
  return stored && VALID_PAGES.has(stored) ? stored : "overview";
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase("en-US")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "voice-project";
}

export function App() {
  const [accessStatus, setAccessStatus] = useState<AccessStatus | null>(null);
  const [accessChecking, setAccessChecking] = useState(true);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [page, setPage] = useState<AppPage>(initialPage);
  const [health, setHealth] = useState<HealthStatus>(OFFLINE_HEALTH);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState(() => localStorage.getItem(LAST_PROJECT_KEY) ?? "");
  const [dashboard, setDashboard] = useState<DashboardData>(EMPTY_DASHBOARD);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [demoMode, setDemoMode] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);

  const notify = useCallback((tone: ToastMessage["tone"], title: string, detail: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1_000);
    setToasts((current) => [...current.slice(-3), { id, tone, title, detail }]);
    window.setTimeout(() => setToasts((current) => current.filter((message) => message.id !== id)), 5_500);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((message) => message.id !== id));
  }, []);

  const markServerUnavailable = useCallback(() => {
    setDemoMode(true);
    setHealth(OFFLINE_HEALTH);
  }, []);

  const navigate = useCallback((destination: AppPage) => {
    setPage(destination);
    localStorage.setItem(LAST_PAGE_KEY, destination);
    window.history.replaceState(null, "", `#/${destination}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const checkAccess = useCallback(async () => {
    setAccessChecking(true);
    setAccessError(null);
    setPairingError(null);
    try {
      setAccessStatus(await api.accessStatus());
    } catch (error) {
      if (isServerUnavailable(error)) {
        // Continue into the existing disconnected preview flow when the Mac server is offline.
        setAccessStatus(null);
      } else {
        setAccessError(error instanceof Error ? error.message : "Voice Foundry could not verify access for this device.");
      }
    } finally {
      setAccessChecking(false);
    }
  }, []);

  const pairDevice = useCallback(async (code: string) => {
    setPairing(true);
    setPairingError(null);
    try {
      const nextStatus = await api.pairDevice(code);
      if (nextStatus.requiresPairing || !nextStatus.authenticated) {
        setPairingError("The Mac did not confirm this pairing. Check the code and try again.");
        return;
      }
      setAccessStatus(nextStatus);
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "PAIRING_CODE_INVALID") {
        setPairingError("That code did not match. Check the six digits printed in the server terminal on your Mac.");
      } else if (error instanceof ApiRequestError && error.code === "PAIRING_RATE_LIMITED") {
        setPairingError("Too many attempts. Wait a moment, then enter the current code from your Mac.");
      } else {
        setPairingError(error instanceof Error ? error.message : "This iPhone could not be paired.");
      }
    } finally {
      setPairing(false);
    }
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash.replace(/^#\/?/, "") as AppPage;
      if (VALID_PAGES.has(hash)) setPage(hash);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    void checkAccess();
  }, [checkAccess]);

  useEffect(() => {
    const requireAccessCheck = () => { void checkAccess(); };
    window.addEventListener(ACCESS_REQUIRED_EVENT, requireAccessCheck);
    return () => window.removeEventListener(ACCESS_REQUIRED_EVENT, requireAccessCheck);
  }, [checkAccess]);

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      try {
        const [nextHealth, nextProjects] = await Promise.all([api.health(), api.projects()]);
        if (cancelled) return;
        setHealth(nextHealth);
        setDemoMode(false);
        setProjects(nextProjects);
        setProjectId((current) => nextProjects.some((project) => project.id === current) ? current : (nextProjects[0]?.id ?? ""));
      } catch (error) {
        if (!cancelled && isServerUnavailable(error)) {
          setHealth(OFFLINE_HEALTH);
          setDemoMode(true);
          setProjects(mockProjects);
          setProjectId((current) => mockProjects.some((project) => project.id === current) ? current : (mockProjects[0]?.id ?? ""));
        }
      }
    };
    if (!accessChecking && !accessError && !accessStatus?.requiresPairing) void initialize();
    return () => { cancelled = true; };
  }, [accessChecking, accessError, accessStatus?.requiresPairing]);

  useEffect(() => {
    if (!projectId) return;
    localStorage.setItem(LAST_PROJECT_KEY, projectId);
    let cancelled = false;
    const loadDashboard = async () => {
      setDashboardLoading(true);
      try {
        const next = demoMode ? mockDashboard : await api.dashboard(projectId);
        if (!cancelled) setDashboard(next);
      } catch (error) {
        if (!cancelled) {
          if (!isServerUnavailable(error)) {
            notify("error", "Dashboard could not load", error instanceof Error ? error.message : "Please try again.");
            return;
          }
          markServerUnavailable();
          setDashboard(mockDashboard);
        }
      } finally {
        if (!cancelled) setDashboardLoading(false);
      }
    };
    void loadDashboard();
    return () => { cancelled = true; };
  }, [demoMode, markServerUnavailable, notify, projectId]);

  const createProject = async () => {
    if (!projectName.trim()) return;
    if (demoMode) {
      notify("info", "Reconnect to create a project", "Projects are stored by the local server so they survive browser restarts.");
      return;
    }
    setCreatingProject(true);
    try {
      const project = await api.createProject(projectName.trim());
      setProjects((current) => [project, ...current]);
      setProjectId(project.id);
      setProjectName("");
      setCreateOpen(false);
      notify("success", "Project created", `${project.name} is ready for a phrase import.`);
      navigate("import");
    } catch (error) {
      notify("error", "Project did not save", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setCreatingProject(false);
    }
  };

  const disconnectDevice = async () => {
    if (!accessStatus || accessStatus.clientIsLoopback) return;
    setDisconnecting(true);
    try {
      await api.unpairDevice();
      setProjects([]);
      setProjectId("");
      setDashboard(EMPTY_DASHBOARD);
      setDemoMode(false);
      setAccessStatus({ ...accessStatus, authenticated: false, requiresPairing: true, sessionExpiresAt: null });
    } catch (error) {
      notify("error", "iPhone stayed connected", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setDisconnecting(false);
    }
  };

  const project = projects.find((item) => item.id === projectId) ?? projects[0];

  if (accessChecking || accessError || accessStatus?.requiresPairing) {
    return (
      <PairingGate
        checking={accessChecking}
        pairing={pairing}
        accessError={accessError}
        pairingError={pairingError}
        onPair={pairDevice}
        onRetry={() => void checkAccess()}
      />
    );
  }

  return (
    <>
      <Shell
        page={page}
        onNavigate={navigate}
        projects={projects}
        projectId={project?.id ?? ""}
        onProjectChange={setProjectId}
        onCreateProject={() => setCreateOpen(true)}
        health={health}
        isDemoMode={demoMode}
        isLanConnection={Boolean(accessStatus?.lanAccessEnabled && !accessStatus.clientIsLoopback)}
        disconnecting={disconnecting}
        onDisconnectDevice={() => void disconnectDevice()}
      >
        {!project ? (
          <div className="page-stack first-project-page">
            <Card><EmptyState icon={<FolderPlus />} title="Create your first production project" description="A project keeps one phrase library, its voice recipe, review decisions, and exports together." action={<Button size="lg" onClick={() => setCreateOpen(true)}>Create project</Button>} /></Card>
          </div>
        ) : (
          <>
            {page === "overview" ? <OverviewPage project={project} data={dashboard} loading={dashboardLoading} onNavigate={navigate} /> : null}
            {page === "import" ? <ImportPage projectId={project.id} isDemoMode={demoMode} onServerUnavailable={markServerUnavailable} onNavigate={navigate} notify={notify} /> : null}
            {page === "phrases" ? <PhrasesPage projectId={project.id} isDemoMode={demoMode} onServerUnavailable={markServerUnavailable} notify={notify} /> : null}
            {page === "voice" ? <VoiceProfilePage projectId={project.id} isDemoMode={demoMode} providerMode={health.providerMode} onServerUnavailable={markServerUnavailable} onOpenSettings={() => navigate("settings")} notify={notify} /> : null}
            {page === "production" ? <ProductionPage projectId={project.id} isDemoMode={demoMode} onServerUnavailable={markServerUnavailable} onNavigate={navigate} notify={notify} /> : null}
            {page === "review" ? <ReviewPage projectId={project.id} isDemoMode={demoMode} onServerUnavailable={markServerUnavailable} notify={notify} /> : null}
            {page === "exports" ? <ExportsPage projectId={project.id} isDemoMode={demoMode} onServerUnavailable={markServerUnavailable} notify={notify} /> : null}
            {page === "settings" ? <SettingsPage health={health} isDemoMode={demoMode} onServerUnavailable={markServerUnavailable} notify={notify} /> : null}
          </>
        )}
      </Shell>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New production project" description="Use one project for a related phrase library and its versioned audio exports.">
        <div className="modal__body">
          <Field label="Project name"><input autoFocus value={projectName} onChange={(event) => setProjectName(event.currentTarget.value)} placeholder="Mara · Lesson celebrations" onKeyDown={(event) => { if (event.key === "Enter") void createProject(); }} /></Field>
          {projectName.trim() ? <p className="project-code-preview"><FolderPlus size={16} /> Project name: <strong>{projectName.trim()}</strong></p> : null}
        </div>
        <div className="modal__footer"><Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button><Button loading={creatingProject} disabled={!projectName.trim()} onClick={() => void createProject()}>{demoMode ? "Reconnect to create" : "Create project"}</Button></div>
      </Modal>

      <ToastViewport messages={toasts} dismiss={dismissToast} />
    </>
  );
}
