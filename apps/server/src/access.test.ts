import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { LAN_API_RATE_LIMIT_PER_MINUTE, LAN_SESSION_TTL_SECONDS } from "./access.js";
import { buildApp } from "./app.js";
import { readConfig } from "./config.js";
import { MockTtsProvider } from "./providers/mock.js";
import { testConfig } from "./test-helpers.js";

const macAddress = "192.168.50.10";
const phoneAddress = "192.168.50.25";
const pairingCode = "042731";
const sameOrigin = `http://${macAddress}:4317`;

function responseJson(response: LightMyRequestResponse): Record<string, unknown> {
  return JSON.parse(response.body) as Record<string, unknown>;
}

function sessionCookie(response: LightMyRequestResponse): string {
  const setCookie = response.headers["set-cookie"];
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!header) throw new Error("The response did not set a session cookie.");
  return header.split(";", 1)[0] ?? "";
}

function injectFrom(
  app: FastifyInstance,
  options: Omit<InjectOptions, "remoteAddress">,
  remoteAddress = phoneAddress,
): Promise<LightMyRequestResponse> {
  return app.inject({
    ...options,
    remoteAddress,
    headers: {
      host: `${macAddress}:4317`,
      ...options.headers,
    },
  });
}

describe("opt-in LAN access", () => {
  const cleanups: Array<() => void> = [];
  const apps: FastifyInstance[] = [];

  async function createLanApp(options: { now?: () => number } = {}): Promise<FastifyInstance> {
    const setup = testConfig();
    cleanups.push(setup.cleanup);
    const built = await buildApp({
      config: { ...setup.config, lanAccessEnabled: true, host: "0.0.0.0" },
      provider: new MockTtsProvider(),
      elevenLabsProvider: new MockTtsProvider(),
      startQueue: false,
      accessControlOptions: { lanAddresses: [macAddress], pairingCode, ...options },
    });
    apps.push(built.app);
    return built.app;
  }

  afterEach(async () => {
    while (apps.length) await apps.pop()?.close();
    while (cleanups.length) cleanups.pop()?.();
  });

  it("keeps loopback binding as the default and binds all IPv4 interfaces only when opted in", () => {
    const ordinary = readConfig({}, {});
    expect(ordinary).toMatchObject({ lanAccessEnabled: false, host: "127.0.0.1" });
    const lan = readConfig({}, { LAN_ACCESS_ENABLED: "true" });
    expect(lan).toMatchObject({ lanAccessEnabled: true, host: "0.0.0.0" });
  });

  it("leaves the pairing UI public but protects every non-access API route", async () => {
    const app = await createLanApp();
    const status = await injectFrom(app, { method: "GET", url: "/api/access/status" });
    expect(status.statusCode).toBe(200);
    expect(responseJson(status)).toEqual({
      lanAccessEnabled: true,
      clientIsLoopback: false,
      authenticated: false,
      requiresPairing: true,
      sessionExpiresAt: null,
      lanUrls: [],
      pairingCode: null,
    });
    expect(status.headers["cache-control"]).toBe("no-store");

    const staticPage = await injectFrom(app, { method: "GET", url: "/" });
    expect(staticPage.statusCode).not.toBe(401);
    expect(staticPage.body).not.toContain("LAN_PAIRING_REQUIRED");

    const health = await injectFrom(app, { method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(401);
    expect(health.headers["cache-control"]).toBe("no-store");
    expect(responseJson(health)).toMatchObject({ error: { code: "LAN_PAIRING_REQUIRED" } });
    for (const url of ["/api/audio/not-a-take", "/api/exports/not-an-export/download"]) {
      const protectedDownload = await injectFrom(app, { method: "GET", url });
      expect(protectedDownload.statusCode).toBe(401);
      expect(responseJson(protectedDownload)).toMatchObject({ error: { code: "LAN_PAIRING_REQUIRED" } });
    }
    const lookalike = await injectFrom(app, { method: "GET", url: "/api/access/status/extra" });
    expect(lookalike.statusCode).toBe(401);
  });

  it("pairs, authenticates, binds the session to the phone address, and unpairs", async () => {
    const app = await createLanApp();
    const incorrect = await injectFrom(app, {
      method: "POST",
      url: "/api/access/pair",
      headers: { origin: sameOrigin },
      payload: { code: "111111" },
    });
    expect(incorrect.statusCode).toBe(401);
    expect(responseJson(incorrect)).toMatchObject({ error: { code: "PAIRING_CODE_INVALID", retryable: false } });

    const paired = await injectFrom(app, {
      method: "POST",
      url: "/api/access/pair",
      headers: { origin: sameOrigin },
      payload: { code: pairingCode },
    });
    expect(paired.statusCode).toBe(200);
    expect(responseJson(paired)).toMatchObject({ authenticated: true, requiresPairing: false, pairingCode: null, lanUrls: [] });
    expect(paired.body).not.toContain(pairingCode);
    const setCookie = String(paired.headers["set-cookie"]);
    expect(setCookie).toContain("voice_foundry_lan_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain(`Max-Age=${LAN_SESSION_TTL_SECONDS}`);
    expect(setCookie).not.toMatch(/;\s*Secure(?:;|$)/i);
    const cookie = sessionCookie(paired);

    const health = await injectFrom(app, { method: "GET", url: "/api/health", headers: { cookie } });
    expect(health.statusCode).toBe(200);
    const originlessMutation = await injectFrom(app, {
      method: "POST",
      url: "/api/projects",
      headers: { cookie },
      payload: { name: "Must not be created" },
    });
    expect(originlessMutation.statusCode).toBe(403);
    expect(responseJson(originlessMutation)).toMatchObject({ error: { code: "ORIGIN_REQUIRED" } });
    const allowedMutation = await injectFrom(app, {
      method: "POST",
      url: "/api/projects",
      headers: { cookie, origin: sameOrigin },
      payload: { name: "Created from iPhone" },
    });
    expect(allowedMutation.statusCode).toBe(201);
    const status = await injectFrom(app, { method: "GET", url: "/api/access/status", headers: { cookie } });
    expect(responseJson(status)).toMatchObject({ authenticated: true, requiresPairing: false });
    expect(responseJson(status).sessionExpiresAt).toEqual(expect.any(String));

    const movedCookie = await injectFrom(app, { method: "GET", url: "/api/health", headers: { cookie } }, "192.168.50.26");
    expect(movedCookie.statusCode).toBe(401);

    const unpaired = await injectFrom(app, { method: "POST", url: "/api/access/unpair", headers: { cookie, origin: sameOrigin } });
    expect(unpaired.statusCode).toBe(204);
    expect(String(unpaired.headers["set-cookie"])).toContain("Max-Age=0");
    const rejectedAfterUnpair = await injectFrom(app, { method: "GET", url: "/api/health", headers: { cookie } });
    expect(rejectedAfterUnpair.statusCode).toBe(401);
  });

  it("trusts only the socket address and enforces LAN Host and same-origin checks", async () => {
    const app = await createLanApp();
    const spoofedLoopback = await injectFrom(app, {
      method: "GET",
      url: "/api/health",
      headers: { "x-forwarded-for": "127.0.0.1" },
    });
    expect(spoofedLoopback.statusCode).toBe(401);

    const foreignHost = await injectFrom(app, { method: "GET", url: "/api/access/status", headers: { host: "192.168.50.99:4317" } });
    expect(foreignHost.statusCode).toBe(403);
    expect(responseJson(foreignHost)).toMatchObject({ error: { code: "INVALID_HOST" } });

    const loopbackHostFromPhone = await injectFrom(app, { method: "GET", url: "/api/access/status", headers: { host: "127.0.0.1:4317" } });
    expect(loopbackHostFromPhone.statusCode).toBe(403);

    const foreignOrigin = await injectFrom(app, {
      method: "GET",
      url: "/api/access/status",
      headers: { origin: "http://evil.example" },
    });
    expect(foreignOrigin.statusCode).toBe(403);
    expect(responseJson(foreignOrigin)).toMatchObject({ error: { code: "FOREIGN_ORIGIN_REJECTED" } });

    const wrongPortOrigin = await injectFrom(app, {
      method: "GET",
      url: "/api/access/status",
      headers: { origin: `http://${macAddress}:5173` },
    });
    expect(wrongPortOrigin.statusCode).toBe(403);

    const missingMutationOrigin = await injectFrom(app, {
      method: "POST",
      url: "/api/access/pair",
      payload: { code: pairingCode },
    });
    expect(missingMutationOrigin.statusCode).toBe(403);
    expect(responseJson(missingMutationOrigin)).toMatchObject({ error: { code: "ORIGIN_REQUIRED" } });

    const sameOrigin = await injectFrom(app, {
      method: "GET",
      url: "/api/access/status",
      headers: { origin: `http://${macAddress}:4317` },
    });
    expect(sameOrigin.statusCode).toBe(200);
    expect(sameOrigin.headers["access-control-allow-origin"]).toBe(`http://${macAddress}:4317`);

    const publicInternetClient = await injectFrom(app, { method: "GET", url: "/api/access/status" }, "203.0.113.9");
    expect(publicInternetClient.statusCode).toBe(403);
    expect(responseJson(publicInternetClient)).toMatchObject({ error: { code: "LAN_CLIENT_NOT_ALLOWED" } });
  });

  it("keeps the Mac trusted while never returning its terminal-only pairing code", async () => {
    const app = await createLanApp();
    const localStatus = await injectFrom(app, {
      method: "GET",
      url: "/api/access/status",
      headers: { host: "127.0.0.1:4317" },
    }, "127.0.0.1");
    expect(localStatus.statusCode).toBe(200);
    expect(responseJson(localStatus)).toEqual({
      lanAccessEnabled: true,
      clientIsLoopback: true,
      authenticated: true,
      requiresPairing: false,
      sessionExpiresAt: null,
      lanUrls: [`http://${macAddress}:4317`],
      pairingCode: null,
    });
    expect(localStatus.body).not.toContain(pairingCode);
    const localHealth = await injectFrom(app, {
      method: "GET",
      url: "/api/health",
      headers: { host: "127.0.0.1:4317" },
    }, "127.0.0.1");
    expect(localHealth.statusCode).toBe(200);
  });

  it("expires sessions and requires pairing again", async () => {
    let now = Date.UTC(2026, 7, 13, 12, 0, 0);
    const app = await createLanApp({ now: () => now });
    const paired = await injectFrom(app, { method: "POST", url: "/api/access/pair", headers: { origin: sameOrigin }, payload: { code: pairingCode } });
    const cookie = sessionCookie(paired);
    now += LAN_SESSION_TTL_SECONDS * 1_000 + 1;
    const status = await injectFrom(app, { method: "GET", url: "/api/access/status", headers: { cookie } });
    expect(responseJson(status)).toMatchObject({ authenticated: false, requiresPairing: true, sessionExpiresAt: null });
    const health = await injectFrom(app, { method: "GET", url: "/api/health", headers: { cookie } });
    expect(health.statusCode).toBe(401);
  });

  it("rate-limits pairing guesses per phone and across phones", async () => {
    const app = await createLanApp();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await injectFrom(app, { method: "POST", url: "/api/access/pair", headers: { origin: sameOrigin }, payload: { code: "999999" } });
      expect(response.statusCode).toBe(401);
    }
    const throttled = await injectFrom(app, { method: "POST", url: "/api/access/pair", headers: { origin: sameOrigin }, payload: { code: pairingCode } });
    expect(throttled.statusCode).toBe(429);
    expect(throttled.headers["retry-after"]).toBe("900");
    expect(responseJson(throttled)).toMatchObject({ error: { code: "PAIRING_RATE_LIMITED", retryable: true } });

    const globalApp = await createLanApp();
    for (let suffix = 50; suffix < 70; suffix += 1) {
      const response = await injectFrom(globalApp, { method: "POST", url: "/api/access/pair", headers: { origin: sameOrigin }, payload: { code: "999999" } }, `192.168.50.${suffix}`);
      expect(response.statusCode).toBe(401);
    }
    const globallyThrottled = await injectFrom(globalApp, { method: "POST", url: "/api/access/pair", headers: { origin: sameOrigin }, payload: { code: pairingCode } }, "192.168.50.70");
    expect(globallyThrottled.statusCode).toBe(429);
    expect(responseJson(globallyThrottled)).toMatchObject({ error: { code: "PAIRING_RATE_LIMITED" } });
  });

  it("rate-limits only LAN API traffic and does not throttle static files", async () => {
    const app = await createLanApp();
    for (let request = 0; request < LAN_API_RATE_LIMIT_PER_MINUTE; request += 1) {
      const response = await injectFrom(app, { method: "GET", url: "/api/access/status" });
      expect(response.statusCode).toBe(200);
    }
    const throttled = await injectFrom(app, { method: "GET", url: "/api/access/status" });
    expect(throttled.statusCode).toBe(429);
    expect(responseJson(throttled)).toMatchObject({ error: { code: "LAN_RATE_LIMITED" } });
    const staticPage = await injectFrom(app, { method: "GET", url: "/" });
    expect(staticPage.statusCode).not.toBe(429);
  });

  it("cannot be reached remotely at all when LAN access is disabled", async () => {
    const setup = testConfig();
    cleanups.push(setup.cleanup);
    const built = await buildApp({
      config: setup.config,
      provider: new MockTtsProvider(),
      elevenLabsProvider: new MockTtsProvider(),
      startQueue: false,
      accessControlOptions: { lanAddresses: [macAddress], pairingCode },
    });
    apps.push(built.app);
    const response = await injectFrom(built.app, { method: "GET", url: "/api/access/status" });
    expect(response.statusCode).toBe(403);
    expect(responseJson(response)).toMatchObject({ error: { code: "LAN_ACCESS_DISABLED" } });
  });
});
