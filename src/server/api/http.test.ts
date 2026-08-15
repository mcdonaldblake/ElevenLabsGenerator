import { afterEach, describe, expect, it, vi } from "vitest";
import { assertSameOrigin } from "./http";

function browserRequest({
  requestUrl = "http://next-internal:3000/api/speech",
  origin = "http://127.0.0.1:3100",
  host = "127.0.0.1:3100",
  fetchSite = "same-origin",
}: {
  requestUrl?: string;
  origin?: string | null;
  host?: string | null;
  fetchSite?: string | null;
} = {}): Request {
  const headers = new Headers();
  if (origin != null) headers.set("origin", origin);
  if (host != null) headers.set("host", host);
  if (fetchSite != null) headers.set("sec-fetch-site", fetchSite);
  return new Request(requestUrl, { method: "POST", headers });
}

function expectRejected(request: Request): void {
  let thrown: unknown;
  try {
    assertSameOrigin(request);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toMatchObject({
    status: 403,
    publicError: { code: "SAME_ORIGIN_REQUIRED" },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("assertSameOrigin", () => {
  it("accepts matching public Origin and Host when Next rewrites request.url internally", () => {
    expect(() => assertSameOrigin(browserRequest())).not.toThrow();
    expect(() => assertSameOrigin(browserRequest({
      requestUrl: "http://localhost:3000/api/voices/shared/owner/voice/add",
      origin: "https://VOICE.EXAMPLE",
      host: "Voice.Example:443",
    }))).not.toThrow();
  });

  it("rejects cross-host and cross-site requests", () => {
    expectRejected(browserRequest({ origin: "http://evil.example" }));
    expectRejected(browserRequest({ host: "evil.example" }));
    expectRejected(browserRequest({ fetchSite: "cross-site" }));
    expectRejected(browserRequest({ fetchSite: "same-origin, cross-site" }));
  });

  it.each([
    ["missing Origin", { origin: null }],
    ["opaque Origin", { origin: "null" }],
    ["multiple Origins", { origin: "http://127.0.0.1:3100, http://evil.example" }],
    ["Origin credentials", { origin: "http://user@127.0.0.1:3100" }],
    ["Origin path", { origin: "http://127.0.0.1:3100/path" }],
    ["Origin trailing slash", { origin: "http://127.0.0.1:3100/" }],
    ["missing Host", { host: null }],
    ["multiple Hosts", { host: "127.0.0.1:3100, evil.example" }],
    ["Host credentials", { host: "user@127.0.0.1:3100" }],
    ["Host path", { host: "127.0.0.1:3100/path" }],
  ] satisfies Array<[string, Parameters<typeof browserRequest>[0]]>)("rejects %s", (_name, overrides) => {
    expectRejected(browserRequest(overrides));
  });

  it("requires HTTPS in production and on Vercel", () => {
    vi.stubEnv("VERCEL", "1");
    expectRejected(browserRequest());
    expect(() => assertSameOrigin(browserRequest({
      origin: "https://preview.example",
      host: "preview.example",
    }))).not.toThrow();
  });

  it("does not trust x-forwarded-host", () => {
    const request = browserRequest({ origin: "http://evil.example" });
    request.headers.set("x-forwarded-host", "evil.example");
    expectRejected(request);
  });
});
