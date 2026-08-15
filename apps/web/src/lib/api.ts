import type {
  PhraseDecision,
  ProductionMode,
  Project,
  VoiceProfileDraft,
} from "../types";
import {
  normalizeAccountVoices,
  normalizeDashboard,
  normalizeExportPreview,
  normalizeExportRecord,
  normalizeExports,
  normalizeHealth,
  normalizeImportPreview,
  normalizeImportResult,
  normalizePhrase,
  normalizePhrasePage,
  normalizePreflight,
  normalizeProject,
  normalizeProjects,
  normalizeReviewPage,
  normalizeSharedVoicePage,
  normalizeTtsBatch,
  normalizeUsage,
  normalizeVoiceProfile,
  normalizeVoiceProfiles,
} from "./normalize";

const configuredBase = import.meta.env.VITE_API_BASE_URL as string | undefined;
const API_BASE = configuredBase?.replace(/\/$/, "") ?? "";
const REQUEST_TIMEOUT_MS = 12_000;
export const ACCESS_REQUIRED_EVENT = "voice-foundry-access-required";

export type AccessStatus = {
  lanAccessEnabled: boolean;
  clientIsLoopback: boolean;
  authenticated: boolean;
  requiresPairing: boolean;
  sessionExpiresAt: string | null;
  lanUrls: string[];
  pairingCode: string | null;
};

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, status = 0, code = "REQUEST_FAILED", retryable = true) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export function isServerUnavailable(error: unknown): boolean {
  return error instanceof ApiRequestError
    && (error.code === "SERVER_UNAVAILABLE" || error.code === "REQUEST_TIMEOUT");
}

function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

function normalizeAccessStatus(payload: unknown): AccessStatus {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new ApiRequestError("The server returned an invalid access status.", 502, "ACCESS_STATUS_INVALID", false);
  }

  const source = payload as Record<string, unknown>;
  const booleanFields = ["lanAccessEnabled", "clientIsLoopback", "authenticated", "requiresPairing"] as const;
  if (booleanFields.some((field) => typeof source[field] !== "boolean")) {
    throw new ApiRequestError("The server returned an invalid access status.", 502, "ACCESS_STATUS_INVALID", false);
  }

  return {
    lanAccessEnabled: source.lanAccessEnabled as boolean,
    clientIsLoopback: source.clientIsLoopback as boolean,
    authenticated: source.authenticated as boolean,
    requiresPairing: source.requiresPairing as boolean,
    sessionExpiresAt: typeof source.sessionExpiresAt === "string" ? source.sessionExpiresAt : null,
    lanUrls: Array.isArray(source.lanUrls) ? source.lanUrls.filter((url): url is string => typeof url === "string") : [],
    pairingCode: typeof source.pairingCode === "string" ? source.pairingCode : null,
  };
}

function signalAccessRequired(): void {
  window.dispatchEvent(new Event(ACCESS_REQUIRED_EVENT));
}

function errorDetails(payload: unknown): { message: string; code: string; retryable: boolean } {
  if (typeof payload !== "object" || payload === null) {
    return { message: "The local server could not complete the request.", code: "REQUEST_FAILED", retryable: true };
  }
  const source = payload as Record<string, unknown>;
  const nested =
    typeof source.error === "object" && source.error !== null
      ? (source.error as Record<string, unknown>)
      : source;
  return {
    message: typeof nested.message === "string" ? nested.message : "The local server could not complete the request.",
    code: typeof nested.code === "string" ? nested.code : "REQUEST_FAILED",
    retryable: typeof nested.retryable === "boolean" ? nested.retryable : true,
  };
}

async function request(path: string, options: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  const headers = new Headers(options.headers);
  if (typeof options.body === "string" && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  headers.set("accept", "application/json");

  try {
    const response = await fetch(apiUrl(path), {
      ...options,
      credentials: "include",
      headers,
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") ?? "";
    const payload: unknown = response.status === 204
      ? null
      : contentType.includes("application/json")
        ? await response.json()
        : await response.text();
    if (!response.ok) {
      const details = errorDetails(payload);
      if (details.code === "LAN_PAIRING_REQUIRED" || details.code === "ACCESS_PAIRING_REQUIRED") {
        signalAccessRequired();
      }
      throw new ApiRequestError(details.message, response.status, details.code, details.retryable);
    }
    return payload;
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiRequestError("The local server took too long to respond.", 0, "REQUEST_TIMEOUT", true);
    }
    throw new ApiRequestError("The local server is not available.", 0, "SERVER_UNAVAILABLE", true);
  } finally {
    window.clearTimeout(timeout);
  }
}

function query(parameters: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined && String(value).length > 0) search.set(key, String(value));
  }
  const result = search.toString();
  return result ? `?${result}` : "";
}

function jsonBody(value: unknown): string {
  return JSON.stringify(value);
}

export const api = {
  async accessStatus(): Promise<AccessStatus> {
    return normalizeAccessStatus(await request("/api/access/status"));
  },

  async recheckAccess(): Promise<AccessStatus> {
    const status = normalizeAccessStatus(await request("/api/access/status"));
    if (status.requiresPairing) signalAccessRequired();
    return status;
  },

  async pairDevice(code: string): Promise<AccessStatus> {
    return normalizeAccessStatus(await request("/api/access/pair", {
      method: "POST",
      body: jsonBody({ code }),
    }));
  },

  async unpairDevice(): Promise<void> {
    await request("/api/access/unpair", { method: "POST", body: jsonBody({}) });
  },

  async health() {
    return normalizeHealth(await request("/api/health"));
  },

  async dashboard(projectId: string) {
    return normalizeDashboard(await request(`/api/dashboard${query({ projectId })}`));
  },

  async projects() {
    return normalizeProjects(await request("/api/projects"));
  },

  async createProject(name: string): Promise<Project> {
    return normalizeProject(
      await request("/api/projects", { method: "POST", body: jsonBody({ name, description: "Local phrase and audio production project" }) }),
    );
  },

  async previewImport(file: File, projectId: string) {
    const form = new FormData();
    if (projectId) form.set("projectId", projectId);
    form.set("file", file);
    return normalizeImportPreview(await request("/api/imports/preview", { method: "POST", body: form }, 120_000), file.name);
  },

  async commitImport(file: File, projectId: string) {
    const form = new FormData();
    if (projectId) form.set("projectId", projectId);
    form.set("file", file);
    return normalizeImportResult(await request("/api/imports", { method: "POST", body: form }, 120_000));
  },

  async phrases(parameters: {
    projectId: string;
    page: number;
    pageSize: number;
    search?: string;
    decision?: string;
    audioStatus?: string;
  }) {
    const audioMap: Record<string, string> = {
      none: "no_audio",
      queued: "pending_review",
      ready: "primary_selected",
      failed: "reviewed_no_primary",
    };
    const serverParameters = {
      ...parameters,
      audioStatus: parameters.audioStatus ? (audioMap[parameters.audioStatus] ?? parameters.audioStatus) : undefined,
    };
    return normalizePhrasePage(await request(`/api/phrases${query(serverParameters)}`), parameters.page, parameters.pageSize);
  },

  async updatePhrase(id: string, patch: Record<string, string | null>) {
    return normalizePhrase(await request(`/api/phrases/${encodeURIComponent(id)}`, { method: "PATCH", body: jsonBody(patch) }));
  },

  async reviewPhrase(id: string, nextDecision: PhraseDecision, takeId?: string) {
    const body: { decision: PhraseDecision; takeId?: string } = { decision: nextDecision };
    if (takeId) body.takeId = takeId;
    return request(`/api/phrases/${encodeURIComponent(id)}/review`, { method: "POST", body: jsonBody(body) });
  },

  async bulkReview(phraseIds: string[], nextDecision: PhraseDecision) {
    return request("/api/phrases/bulk-review", {
      method: "POST",
      body: jsonBody({ phraseIds, decision: nextDecision }),
    });
  },

  async voiceProfiles(projectId: string) {
    return normalizeVoiceProfiles(await request(`/api/voice-profiles${query({ projectId })}`));
  },

  async createVoiceProfile(draft: VoiceProfileDraft) {
    return normalizeVoiceProfile(await request("/api/voice-profiles", { method: "POST", body: jsonBody(draft) }));
  },

  async lockVoiceProfile(id: string) {
    return normalizeVoiceProfile(
      await request(`/api/voice-profiles/${encodeURIComponent(id)}/lock`, { method: "POST", body: jsonBody({}) }),
    );
  },

  async accountVoices() {
    return normalizeAccountVoices(await request("/api/voices/account"));
  },

  async sharedVoices(parameters: {
    page: number;
    pageSize: number;
    search?: string;
    language?: string;
    accent?: string;
    gender?: string;
    age?: string;
    category?: string;
    useCase?: string;
    featured?: boolean;
    sort?: string;
  }) {
    return normalizeSharedVoicePage(
      await request(`/api/voices/shared${query({
        ...parameters,
        featured: parameters.featured ? "true" : undefined,
      })}`),
      parameters.page,
      parameters.pageSize,
    );
  },

  async addSharedVoice(publicOwnerId: string, voiceId: string, newName?: string) {
    const payload = await request(
      `/api/voices/shared/${encodeURIComponent(publicOwnerId)}/${encodeURIComponent(voiceId)}/add`,
      { method: "POST", body: jsonBody({ ...(newName ? { newName } : {}) }) },
    );
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new ApiRequestError("The server returned an invalid voice result.", 502, "SHARED_VOICE_ADD_INVALID", false);
    }
    const resultVoiceId = (payload as Record<string, unknown>).voiceId ?? (payload as Record<string, unknown>).voice_id;
    if (typeof resultVoiceId !== "string" || !resultVoiceId) {
      throw new ApiRequestError("The server returned an invalid voice result.", 502, "SHARED_VOICE_ADD_INVALID", false);
    }
    return { voiceId: resultVoiceId };
  },

  sharedVoicePreviewUrl(previewUrl: string) {
    return apiUrl(`/api/voices/shared/preview${query({ url: previewUrl })}`);
  },

  async testElevenLabs() {
    return request("/api/providers/elevenlabs/test", { method: "POST", body: jsonBody({}) });
  },

  async usage() {
    return normalizeUsage(await request("/api/usage/summary"));
  },

  async settings() {
    return request("/api/settings");
  },

  async updateSettings(patch: { autoAdvance?: boolean; lastProjectId?: string | null; lastPage?: string }) {
    return request("/api/settings", { method: "PATCH", body: jsonBody(patch) });
  },

  async preflight(projectId: string, voiceProfileVersionId: string, mode: ProductionMode, phraseIds?: string[], selection?: { missingOnly: boolean; limit: number }) {
    return normalizePreflight(
      await request("/api/tts/preflight", {
        method: "POST",
        body: jsonBody({ projectId, voiceProfileVersionId, mode, ...(phraseIds ? { phraseIds } : {}), ...(selection ?? {}) }),
      }),
      mode,
    );
  },

  async createBatch(projectId: string, voiceProfileVersionId: string, mode: ProductionMode, phraseIds?: string[], selection?: { missingOnly: boolean; limit: number }) {
    return normalizeTtsBatch(
      await request("/api/tts/batches", {
        method: "POST",
        body: jsonBody({ projectId, voiceProfileVersionId, mode, confirmed: true, ...(phraseIds ? { phraseIds } : {}), ...(selection ?? {}) }),
      }),
    );
  },

  async batch(id: string) {
    return normalizeTtsBatch(await request(`/api/tts/batches/${encodeURIComponent(id)}`));
  },

  async batches(projectId: string, limit = 1) {
    const payload = await request(`/api/tts/batches${query({ projectId, limit })}`);
    const source = typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? ((payload as Record<string, unknown>).items ?? (payload as Record<string, unknown>).batches ?? [])
      : payload;
    return Array.isArray(source) ? source.map(normalizeTtsBatch) : [];
  },

  async cancelBatch(id: string) {
    return normalizeTtsBatch(
      await request(`/api/tts/batches/${encodeURIComponent(id)}/cancel`, { method: "POST", body: jsonBody({}) }),
    );
  },

  async retryBatch(id: string) {
    return normalizeTtsBatch(
      await request(`/api/tts/batches/${encodeURIComponent(id)}/retry`, { method: "POST", body: jsonBody({}) }),
    );
  },

  async review(projectId: string, reviewDecision?: "pending" | "kept" | "discarded", page = 1, pageSize = 200) {
    return normalizeReviewPage(
      await request(`/api/review${query({ projectId, decision: reviewDecision, page, pageSize })}`),
    );
  },

  audioUrl(takeId: string) {
    return apiUrl(`/api/audio/${encodeURIComponent(takeId)}`);
  },

  async reviewAudio(takeId: string, nextDecision: PhraseDecision) {
    return request(`/api/audio/${encodeURIComponent(takeId)}/review`, {
      method: "POST",
      body: jsonBody({ decision: nextDecision }),
    });
  },

  async regeneratePhrase(phraseId: string) {
    return normalizeTtsBatch(await request(`/api/phrases/${encodeURIComponent(phraseId)}/regenerate`, {
      method: "POST",
      body: jsonBody({}),
    }));
  },

  async exportPreview(projectId: string) {
    return normalizeExportPreview(
      await request("/api/exports/preview", { method: "POST", body: jsonBody({ projectId }) }, 120_000),
    );
  },

  async exports(projectId: string) {
    return normalizeExports(await request(`/api/exports${query({ projectId })}`));
  },

  async createExport(projectId: string, label: string) {
    return normalizeExportRecord(
      await request("/api/exports", { method: "POST", body: jsonBody({ projectId, label }) }, 120_000),
    );
  },

  exportDownloadUrl(id: string) {
    return apiUrl(`/api/exports/${encodeURIComponent(id)}/download`);
  },
};
