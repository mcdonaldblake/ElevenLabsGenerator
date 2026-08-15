import { existsSync } from "node:fs";
import { resolve } from "node:path";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import staticFiles from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { z, ZodError } from "zod";
import { LanAccessControl, type AccessControlOptions } from "./access.js";
import { registerApiRoutes } from "./api/routes.js";
import { readConfig, type ServerConfig } from "./config.js";
import { openDatabase, type DatabaseContext } from "./db/client.js";
import { AppError } from "./errors.js";
import { TtsQueue } from "./jobs/queue.js";
import { loggerOptions } from "./logger.js";
import { createTtsProvider, ElevenLabsTtsProvider, type TtsProvider } from "./providers/index.js";
import { ExportService } from "./services/exports.js";
import { ImportService } from "./services/imports.js";
import { LibraryService } from "./services/library.js";
import { ProfileService } from "./services/profiles.js";

export type BuildAppOptions = {
  config?: ServerConfig;
  database?: DatabaseContext;
  provider?: TtsProvider;
  elevenLabsProvider?: TtsProvider;
  startQueue?: boolean;
  accessControlOptions?: AccessControlOptions;
};

export type BuiltApp = {
  app: FastifyInstance;
  config: ServerConfig;
  database: DatabaseContext;
  queue: TtsQueue;
  access: LanAccessControl;
};

export async function buildApp(options: BuildAppOptions = {}): Promise<BuiltApp> {
  const config = options.config ?? readConfig();
  const serverOptions: FastifyServerOptions = {
    logger: config.nodeEnv === "test" ? false : loggerOptions(config.logLevel) as Exclude<FastifyServerOptions["logger"], undefined>,
    bodyLimit: 2_000_000,
    requestTimeout: 120_000,
    trustProxy: false,
  };
  const app = Fastify(serverOptions);
  const database = options.database ?? openDatabase(config);
  const provider = options.provider ?? createTtsProvider(config);
  const elevenLabsProvider = options.elevenLabsProvider ?? new ElevenLabsTtsProvider({
    apiKey: config.elevenLabsApiKey,
    baseUrl: config.elevenLabsApiBaseUrl,
  });
  const queue = new TtsQueue(database, provider, config);
  const access = new LanAccessControl(config, options.accessControlOptions);

  app.addHook("onRequest", async (request, reply) => {
    access.validateRequestTarget(request);
    if ((request.raw.url ?? request.url).startsWith("/api/")) reply.header("cache-control", "no-store");
    const retryAfter = access.apiRetryAfter(request);
    if (retryAfter !== null) {
      reply.header("retry-after", retryAfter);
      throw new AppError(429, "LAN_RATE_LIMITED", "This device is sending requests too quickly. Try again shortly.", { retryable: true });
    }
    access.authorizeApi(request);
  });

  await app.register(cors, {
    origin: (origin, callback) => callback(null, !origin || access.isCorsOriginAllowed(origin)),
    methods: ["GET", "HEAD", "POST", "PATCH", "OPTIONS"],
    credentials: true,
  });
  await app.register(multipart, {
    limits: { files: 1, fileSize: config.maxImportBytes, fields: 20, parts: 21 },
    throwFileSizeLimit: true,
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "The request is invalid.",
          retryable: false,
          details: { issues: error.issues },
        },
      });
    }
    if (error instanceof AppError) return reply.code(error.statusCode).send({ error: error.apiError });
    const errorCode = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (errorCode === "FST_REQ_FILE_TOO_LARGE") {
      return reply.code(413).send({ error: { code: "IMPORT_FILE_LIMIT", message: `The import file exceeds ${config.maxImportBytes} bytes.`, retryable: false } });
    }
    if (errorCode.startsWith("SQLITE_CONSTRAINT")) {
      return reply.code(409).send({ error: { code: "CONFLICT", message: "The requested change conflicts with existing local data.", retryable: false } });
    }
    request.log.error({ err: error }, "Unhandled request error");
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "An unexpected local server error occurred.", retryable: false } });
  });

  const pairingSchema = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();
  app.get("/api/access/status", async (request, reply) => reply
    .header("cache-control", "no-store")
    .header("vary", "Cookie, Origin")
    .send(access.status(request)));
  app.post("/api/access/pair", async (request, reply) => {
    const retryAfter = access.pairingRetryAfter(request);
    if (retryAfter !== null) {
      return reply
        .header("retry-after", retryAfter)
        .code(429)
        .send({ error: { code: "PAIRING_RATE_LIMITED", message: "Too many incorrect pairing attempts. Try again later.", retryable: true } });
    }
    const body = pairingSchema.parse(request.body);
    const paired = access.pair(request, body.code);
    if (paired.token) reply.header("set-cookie", access.sessionCookie(paired.token));
    return reply.header("cache-control", "no-store").header("vary", "Cookie, Origin").send(paired.status);
  });
  app.post("/api/access/unpair", async (request, reply) => {
    access.unpair(request);
    return reply.header("set-cookie", access.expiredSessionCookie()).header("cache-control", "no-store").code(204).send();
  });

  await registerApiRoutes(app, {
    config,
    database,
    queue,
    provider,
    elevenLabsProvider,
    imports: new ImportService(database, config.maxImportRows),
    exports: new ExportService(database, config),
    library: new LibraryService(database),
    profiles: new ProfileService(database, provider.name),
    startedAt: Date.now(),
  });

  const webRoot = resolve(config.projectRoot, "apps/web/dist");
  if (existsSync(webRoot)) {
    await app.register(staticFiles, { root: webRoot, prefix: "/", wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.code(404).send({ error: { code: "NOT_FOUND", message: "API route not found.", retryable: false } });
      }
      return reply.sendFile("index.html");
    });
  }

  if (options.startQueue !== false) queue.start();
  app.addHook("onClose", async () => {
    await queue.stop();
    database.close();
  });
  return { app, config, database, queue, access };
}
