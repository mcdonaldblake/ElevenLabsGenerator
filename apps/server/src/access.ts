import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";
import type { FastifyRequest } from "fastify";
import type { ServerConfig } from "./config.js";
import { AppError } from "./errors.js";

export const LAN_SESSION_COOKIE = "voice_foundry_lan_session";
export const LAN_SESSION_TTL_SECONDS = 24 * 60 * 60;
export const LAN_API_RATE_LIMIT_PER_MINUTE = 600;
export const LAN_PAIRING_ATTEMPTS_PER_WINDOW = 5;
export const LAN_PAIRING_GLOBAL_ATTEMPTS_PER_WINDOW = 20;
export const LAN_PAIRING_WINDOW_SECONDS = 15 * 60;

const publicAccessPaths = new Set([
  "/api/access/status",
  "/api/access/pair",
]);

type Session = {
  clientAddress: string;
  expiresAt: number;
};

type RateWindow = {
  count: number;
  resetsAt: number;
};

export type AccessControlOptions = {
  lanAddresses?: readonly string[];
  pairingCode?: string;
  now?: () => number;
};

export type AccessStatus = {
  lanAccessEnabled: boolean;
  clientIsLoopback: boolean;
  authenticated: boolean;
  requiresPairing: boolean;
  sessionExpiresAt: string | null;
  lanUrls: string[];
  pairingCode: string | null;
};

function normalizeAddress(value: string | undefined): string {
  const address = (value ?? "").split("%")[0] ?? "";
  if (address.startsWith("::ffff:")) {
    const mapped = address.slice("::ffff:".length);
    if (isIP(mapped) === 4) return mapped;
  }
  return address;
}

export function isLoopbackAddress(value: string | undefined): boolean {
  const address = normalizeAddress(value);
  if (address === "::1") return true;
  if (isIP(address) !== 4) return false;
  return Number(address.split(".")[0]) === 127;
}

export function isPrivateLanAddress(value: string | undefined): boolean {
  const address = normalizeAddress(value);
  if (isIP(address) !== 4) return false;
  const octets = address.split(".").map(Number);
  const first = octets[0] ?? -1;
  const second = octets[1] ?? -1;
  return first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 169 && second === 254);
}

export function discoverLanAddresses(): string[] {
  const addresses = new Set<string>();
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      const family = String(entry.family);
      if (!entry.internal && (family === "IPv4" || family === "4") && isPrivateLanAddress(entry.address)) {
        addresses.add(entry.address);
      }
    }
  }
  return [...addresses].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

function requestPath(request: FastifyRequest): string {
  return (request.raw.url ?? request.url).split("?", 1)[0] ?? "/";
}

function clientAddress(request: FastifyRequest): string {
  return normalizeAddress(request.raw.socket.remoteAddress ?? request.ip);
}

function parseHost(host: string | undefined): { hostname: string; host: string } | null {
  if (!host || /[\r\n]/.test(host)) return null;
  try {
    const parsed = new URL(`http://${host.trim()}`);
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
    return {
      hostname: parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase(),
      host: parsed.host.toLowerCase(),
    };
  } catch {
    return null;
  }
}

function parseOrigin(origin: string): { hostname: string; host: string; origin: string } | null {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
    return {
      hostname: parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase(),
      host: parsed.host.toLowerCase(),
      origin: parsed.origin.toLowerCase(),
    };
  } catch {
    return null;
  }
}

function cookieValue(header: string | undefined, name: string): string | null {
  for (const part of header?.split(";") ?? []) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    const raw = part.slice(separator + 1).trim();
    try { return decodeURIComponent(raw); } catch { return null; }
  }
  return null;
}

function tokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function generatePairingCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export class LanAccessControl {
  readonly lanAddresses: readonly string[];
  readonly pairingCode: string | null;
  private readonly config: ServerConfig;
  private readonly now: () => number;
  private readonly sessions = new Map<string, Session>();
  private readonly apiWindows = new Map<string, RateWindow>();
  private readonly pairingWindows = new Map<string, RateWindow>();
  private readonly globalPairingWindows = new Map<string, RateWindow>();

  constructor(config: ServerConfig, options: AccessControlOptions = {}) {
    this.config = config;
    this.now = options.now ?? Date.now;
    this.lanAddresses = [...new Set((options.lanAddresses ?? discoverLanAddresses()).filter(isPrivateLanAddress))];
    const suppliedCode = options.pairingCode;
    if (suppliedCode !== undefined && !/^\d{6}$/.test(suppliedCode)) {
      throw new Error("The test pairing code must contain exactly six digits.");
    }
    this.pairingCode = config.lanAccessEnabled ? (suppliedCode ?? generatePairingCode()) : null;
  }

  get lanUrls(): string[] {
    if (!this.config.lanAccessEnabled) return [];
    return this.lanAddresses.map((address) => `http://${address}:${this.config.port}`);
  }

  isCorsOriginAllowed(origin: string): boolean {
    const parsed = parseOrigin(origin);
    if (!parsed) return false;
    if (isLoopbackAddress(parsed.hostname)) return true;
    return this.config.lanAccessEnabled && this.lanAddresses.includes(parsed.hostname);
  }

  validateRequestTarget(request: FastifyRequest): void {
    const address = clientAddress(request);
    const loopbackClient = isLoopbackAddress(address);
    if (!loopbackClient) {
      if (!this.config.lanAccessEnabled) {
        throw new AppError(403, "LAN_ACCESS_DISABLED", "Network access is disabled. Start the server in LAN access mode to connect from another device.");
      }
      if (!isPrivateLanAddress(address)) {
        throw new AppError(403, "LAN_CLIENT_NOT_ALLOWED", "Only devices on a private local network may access this server.");
      }
    }

    const host = parseHost(request.headers.host);
    if (!host) throw new AppError(403, "INVALID_HOST", "The request Host header is invalid.");
    const loopbackHost = isLoopbackAddress(host.hostname) || host.hostname === "localhost";
    const lanHost = this.config.lanAccessEnabled && this.lanAddresses.includes(host.hostname);
    if ((!loopbackClient && !lanHost) || (loopbackClient && !loopbackHost && !lanHost)) {
      throw new AppError(403, "INVALID_HOST", "The server does not accept requests for this host.");
    }

    const rawOrigin = request.headers.origin;
    const mutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    if (!rawOrigin) {
      if (!loopbackClient && mutation) {
        throw new AppError(403, "ORIGIN_REQUIRED", "Network changes require a same-origin browser request.");
      }
      return;
    }
    const origin = parseOrigin(rawOrigin);
    if (!origin) throw new AppError(403, "FOREIGN_ORIGIN_REJECTED", "The browser origin is not allowed.");
    if (!loopbackClient) {
      if (origin.host !== host.host) {
        throw new AppError(403, "FOREIGN_ORIGIN_REJECTED", "Network requests must come from the same origin as this server.");
      }
      return;
    }
    const originIsLoopback = isLoopbackAddress(origin.hostname) || origin.hostname === "localhost";
    const originIsLanHost = this.config.lanAccessEnabled && this.lanAddresses.includes(origin.hostname);
    if (!originIsLoopback && !originIsLanHost) {
      throw new AppError(403, "FOREIGN_ORIGIN_REJECTED", "The browser origin is not allowed.");
    }
  }

  apiRetryAfter(request: FastifyRequest): number | null {
    if (isLoopbackAddress(clientAddress(request)) || !requestPath(request).startsWith("/api/")) return null;
    return this.consume(this.apiWindows, clientAddress(request), LAN_API_RATE_LIMIT_PER_MINUTE, 60_000);
  }

  pairingRetryAfter(request: FastifyRequest): number | null {
    return this.retryAfter(this.pairingWindows, clientAddress(request), LAN_PAIRING_ATTEMPTS_PER_WINDOW, LAN_PAIRING_WINDOW_SECONDS * 1_000)
      ?? this.retryAfter(this.globalPairingWindows, "all", LAN_PAIRING_GLOBAL_ATTEMPTS_PER_WINDOW, LAN_PAIRING_WINDOW_SECONDS * 1_000);
  }

  recordFailedPairing(request: FastifyRequest): void {
    this.record(this.pairingWindows, clientAddress(request), LAN_PAIRING_WINDOW_SECONDS * 1_000);
    this.record(this.globalPairingWindows, "all", LAN_PAIRING_WINDOW_SECONDS * 1_000);
  }

  authenticate(request: FastifyRequest): Session | null {
    if (isLoopbackAddress(clientAddress(request))) return null;
    const token = cookieValue(request.headers.cookie, LAN_SESSION_COOKIE);
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const digest = tokenDigest(token);
    const session = this.sessions.get(digest);
    if (!session) return null;
    if (session.expiresAt <= this.now()) {
      this.sessions.delete(digest);
      return null;
    }
    if (session.clientAddress !== clientAddress(request)) return null;
    return session;
  }

  authorizeApi(request: FastifyRequest): void {
    const path = requestPath(request);
    if (!path.startsWith("/api/") || publicAccessPaths.has(path) || isLoopbackAddress(clientAddress(request))) return;
    if (!this.authenticate(request)) {
      throw new AppError(401, "LAN_PAIRING_REQUIRED", "Pair this device with the Mac before using the Voice Foundry API.");
    }
  }

  status(request: FastifyRequest): AccessStatus {
    const loopbackClient = isLoopbackAddress(clientAddress(request));
    const session = this.authenticate(request);
    const authenticated = loopbackClient || Boolean(session);
    return {
      lanAccessEnabled: this.config.lanAccessEnabled,
      clientIsLoopback: loopbackClient,
      authenticated,
      requiresPairing: this.config.lanAccessEnabled && !authenticated,
      sessionExpiresAt: session ? new Date(session.expiresAt).toISOString() : null,
      lanUrls: loopbackClient ? this.lanUrls : [],
      pairingCode: null,
    };
  }

  pair(request: FastifyRequest, code: string): { token: string | null; status: AccessStatus } {
    if (!this.config.lanAccessEnabled || !this.pairingCode) {
      throw new AppError(409, "LAN_ACCESS_DISABLED", "LAN access is not enabled on this server.");
    }
    if (isLoopbackAddress(clientAddress(request))) return { token: null, status: this.status(request) };
    const expected = Buffer.from(this.pairingCode);
    const received = Buffer.from(code);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      this.recordFailedPairing(request);
      throw new AppError(401, "PAIRING_CODE_INVALID", "The pairing code is incorrect.");
    }
    this.pairingWindows.delete(clientAddress(request));
    this.globalPairingWindows.delete("all");
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(tokenDigest(token), {
      clientAddress: clientAddress(request),
      expiresAt: this.now() + LAN_SESSION_TTL_SECONDS * 1_000,
    });
    return { token, status: this.statusWithToken(token) };
  }

  unpair(request: FastifyRequest): void {
    const token = cookieValue(request.headers.cookie, LAN_SESSION_COOKIE);
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    const digest = tokenDigest(token);
    const session = this.sessions.get(digest);
    if (session?.clientAddress === clientAddress(request)) this.sessions.delete(digest);
  }

  sessionCookie(token: string): string {
    return `${LAN_SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${LAN_SESSION_TTL_SECONDS}`;
  }

  expiredSessionCookie(): string {
    return `${LAN_SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  }

  private statusWithToken(token: string): AccessStatus {
    const session = this.sessions.get(tokenDigest(token));
    return {
      lanAccessEnabled: true,
      clientIsLoopback: false,
      authenticated: true,
      requiresPairing: false,
      sessionExpiresAt: session ? new Date(session.expiresAt).toISOString() : null,
      lanUrls: [],
      pairingCode: null,
    };
  }

  private consume(windows: Map<string, RateWindow>, key: string, limit: number, durationMs: number): number | null {
    const retryAfter = this.retryAfter(windows, key, limit, durationMs);
    if (retryAfter !== null) return retryAfter;
    this.record(windows, key, durationMs);
    return null;
  }

  private retryAfter(windows: Map<string, RateWindow>, key: string, limit: number, durationMs: number): number | null {
    const now = this.now();
    const window = windows.get(key);
    if (!window || window.resetsAt <= now) {
      if (window) windows.delete(key);
      return null;
    }
    return window.count >= limit ? Math.max(1, Math.ceil((window.resetsAt - now) / 1_000)) : null;
  }

  private record(windows: Map<string, RateWindow>, key: string, durationMs: number): void {
    const now = this.now();
    const window = windows.get(key);
    if (!window || window.resetsAt <= now) {
      windows.set(key, { count: 1, resetsAt: now + durationMs });
      return;
    }
    window.count += 1;
  }
}
