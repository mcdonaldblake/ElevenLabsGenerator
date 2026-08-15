import { z } from "zod";
import { ApiError, ProviderError } from "../elevenlabs/errors";

export const RESPONSE_SECURITY_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  "cross-origin-resource-policy": "same-origin",
  "x-content-type-options": "nosniff",
} as const;

const MAX_JSON_REQUEST_BYTES = 32 * 1024;

function queryObject(searchParams: URLSearchParams): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};
  for (const [key, value] of searchParams) {
    const current = query[key];
    if (current === undefined) query[key] = value;
    else query[key] = Array.isArray(current) ? [...current, value] : [current, value];
  }
  return query;
}

export function parseQuery<T>(request: Request, schema: z.ZodType<T>): T {
  return schema.parse(queryObject(new URL(request.url).searchParams));
}

async function readRequestBytes(request: Request): Promise<Uint8Array> {
  const declaredHeader = request.headers.get("content-length");
  if (declaredHeader) {
    const declared = Number(declaredHeader);
    if (!Number.isSafeInteger(declared) || declared < 0 || declared > MAX_JSON_REQUEST_BYTES) {
      throw new ApiError(413, "REQUEST_TOO_LARGE", "The request body is too large.");
    }
  }
  if (!request.body) throw new ApiError(400, "INVALID_JSON", "A JSON request body is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > MAX_JSON_REQUEST_BYTES) {
      await reader.cancel();
      throw new ApiError(413, "REQUEST_TOO_LARGE", "The request body is too large.");
    }
    chunks.push(result.value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function parseJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new ApiError(415, "JSON_REQUIRED", "The request must use application/json.");
  }
  const bytes = await readRequestBytes(request);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new ApiError(400, "INVALID_JSON", "The request body is not valid JSON.");
  }
  return schema.parse(value);
}

function singleHeaderValue(value: string | null): string | null {
  if (
    !value
    || value !== value.trim()
    || value.includes(",")
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return null;
  }
  return value;
}

function normalizedHost(value: string, protocol: "http:" | "https:"): string | null {
  if (!value || /[\s\\/?#@]/.test(value)) return null;

  try {
    const parsed = new URL(`${protocol}//${value}/`);
    if (
      !parsed.hostname
      || parsed.username
      || parsed.password
      || parsed.pathname !== "/"
      || parsed.search
      || parsed.hash
    ) {
      return null;
    }

    let normalizedInput = value.toLowerCase();
    const defaultPort = protocol === "https:" ? ":443" : ":80";
    if (normalizedInput.endsWith(defaultPort)) {
      normalizedInput = normalizedInput.slice(0, -defaultPort.length);
    }

    const canonicalHost = parsed.host.toLowerCase();
    return normalizedInput === canonicalHost ? canonicalHost : null;
  } catch {
    return null;
  }
}

function parsedOrigin(value: string): { host: string; protocol: "http:" | "https:" } | null {
  const match = /^(https?):\/\/([^/?#]+)$/i.exec(value);
  if (!match) return null;

  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      || parsed.username
      || parsed.password
      || parsed.pathname !== "/"
      || parsed.search
      || parsed.hash
    ) {
      return null;
    }

    const protocol = parsed.protocol;
    const host = normalizedHost(match[2] ?? "", protocol);
    if (!host || host !== parsed.host.toLowerCase()) return null;
    return { host, protocol };
  } catch {
    return null;
  }
}

function sameOriginRequired(): never {
  throw new ApiError(403, "SAME_ORIGIN_REQUIRED", "This request must come from the Voice Lab page.");
}

export function assertSameOrigin(request: Request): void {
  const originValue = singleHeaderValue(request.headers.get("origin"));
  const origin = originValue && originValue.toLowerCase() !== "null"
    ? parsedOrigin(originValue)
    : null;
  if (!origin) sameOriginRequired();

  const hostValue = singleHeaderValue(request.headers.get("host"));
  const host = hostValue ? normalizedHost(hostValue, origin.protocol) : null;
  if (!host || host !== origin.host) sameOriginRequired();

  const fetchSiteValue = request.headers.get("sec-fetch-site");
  if (fetchSiteValue != null) {
    const fetchSite = singleHeaderValue(fetchSiteValue)?.toLowerCase();
    if (!fetchSite || fetchSite === "cross-site" || !["same-origin", "same-site", "none"].includes(fetchSite)) {
      sameOriginRequired();
    }
  }

  const deployed = process.env.NODE_ENV === "production"
    || process.env.VERCEL === "1"
    || Boolean(process.env.VERCEL_ENV);
  if (deployed && origin.protocol !== "https:") sameOriginRequired();
}

export function jsonResponse(value: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(RESPONSE_SECURITY_HEADERS);
  headers.set("content-type", "application/json; charset=utf-8");
  if (extraHeaders) for (const [key, value] of new Headers(extraHeaders)) headers.set(key, value);
  return new Response(JSON.stringify(value), { status, headers });
}

function validationDetails(error: z.ZodError): Record<string, unknown> {
  return {
    issues: error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      code: issue.code,
      message: issue.message,
    })),
  };
}

export async function safelyHandle(operation: () => Promise<Response>): Promise<Response> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonResponse({
        error: {
          code: "INVALID_REQUEST",
          message: "The request contains invalid fields.",
          retryable: false,
          details: validationDetails(error),
        },
      }, 400);
    }
    if (error instanceof ApiError) {
      const headers = error instanceof ProviderError && error.retryAfterMs != null
        ? { "retry-after": String(Math.max(1, Math.ceil(error.retryAfterMs / 1_000))) }
        : undefined;
      return jsonResponse({ error: error.publicError }, error.status, headers);
    }
    return jsonResponse({
      error: {
        code: "INTERNAL_ERROR",
        message: "The server could not complete the request.",
        retryable: false,
      },
    }, 500);
  }
}
