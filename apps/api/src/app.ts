import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import swagger from "@fastify/swagger";
import Fastify, { type FastifyServerOptions } from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { Db } from "@kleidi/db";
import type { ObjectStore } from "@kleidi/modules/documents";
import type { Auth } from "@kleidi/modules/identity";
import type { Notifier } from "@kleidi/modules/notifications";
import { registerAuthRoutes } from "./plugins/auth-routes.ts";
import { createContext } from "./plugins/context.ts";
import { registerErrorHandler } from "./plugins/errors.ts";
import { createIdempotency } from "./plugins/idempotency.ts";
import { caseRoutes } from "./routes/cases.ts";
import { clientAccessRoutes } from "./routes/client-access.ts";
import { portalRoutes } from "./routes/portal.ts";
import { deadlineRoutes } from "./routes/deadlines.ts";
import { documentRoutes } from "./routes/documents.ts";
import { firmRoutes } from "./routes/firms.ts";
import { healthRoutes } from "./routes/health.ts";
import { invitationRoutes } from "./routes/invitations.ts";
import { jurisdictionRoutes } from "./routes/jurisdictions.ts";
import { meRoutes } from "./routes/me.ts";

export type AppDeps = {
  db: Db;
  auth: Auth;
  store: ObjectStore;
  notifier: Notifier;
  // Production serves over HTTPS, so cookies there are Secure.
  secureCookies?: boolean;
  // Where browsers upload and download files; the page may connect there as well as to itself.
  storageOrigin?: string | undefined;
  // Requests per minute per client address. Raised only for load tests.
  rateLimitPerMinute?: number;
  // How many proxies sit in front of the API. Only their forwarded address is believed, so a
  // client cannot dodge rate limits by sending its own X-Forwarded-For header.
  trustedProxies?: number;
  // Production hides the API description.
  production?: boolean;
  firmCreators?: string[] | undefined;
  webOrigin: string;
  webDist?: string | undefined;
  logger?: boolean;
};

export async function buildApp(deps: AppDeps) {
  const options: FastifyServerOptions = {
    // Believe only as many forwarding hops as there are proxies in front of us.
    trustProxy: (_address: string, hop: number) => hop < (deps.trustedProxies ?? 0),
    logger: deps.logger
      ? {
          serializers: {
            // Sign-in and invitation links carry secrets in the path; keep them out of logs.
            req: (req: { method: string; url: string }) => ({
              method: req.method,
              url: req.url.replace(/\/(link|invitations|invite)\/[^/?]+/g, "/$1/[redacted]"),
            }),
          },
        }
      : false,
  };
  const app = Fastify(options);
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'", ...(deps.storageOrigin ? [deps.storageOrigin] : [])],
        fontSrc: ["'self'"],
        // React sets inline style attributes; no external stylesheets are allowed.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
  });
  // The app never uses these browser features, so pages may not ask for them.
  app.addHook("onSend", async (_request, reply) => {
    reply.header(
      "permissions-policy",
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    );
  });
  await app.register(cors, {
    origin: deps.webOrigin,
    credentials: true,
    exposedHeaders: ["etag", "location", "idempotent-replayed"],
  });
  await app.register(rateLimit, { max: deps.rateLimitPerMinute ?? 300, timeWindow: "1 minute" });
  await app.register(cookie);
  await app.register(swagger, {
    openapi: { info: { title: "Kleidi API", version: "0.1.0" } },
    transform: jsonSchemaTransform,
  });

  registerAuthRoutes(app, deps.auth);
  const ctx = createContext({ db: deps.db, auth: deps.auth });
  const typed = app.withTypeProvider<ZodTypeProvider>();
  await typed.register(healthRoutes, { db: deps.db });
  await typed.register(jurisdictionRoutes, { db: deps.db, prefix: "/api/v1" });
  await typed.register(meRoutes, { db: deps.db, ctx, prefix: "/api/v1" });
  await typed.register(firmRoutes, {
    db: deps.db,
    ctx,
    firmCreators: deps.firmCreators,
    prefix: "/api/v1",
  });
  await typed.register(invitationRoutes, { db: deps.db, ctx, prefix: "/api/v1" });
  const idempotent = createIdempotency(deps.db);
  await typed.register(caseRoutes, { db: deps.db, ctx, idempotent, prefix: "/api/v1" });
  await typed.register(clientAccessRoutes, {
    db: deps.db,
    ctx,
    notifier: deps.notifier,
    webOrigin: deps.webOrigin,
    prefix: "/api/v1",
  });
  await typed.register(portalRoutes, {
    db: deps.db,
    store: deps.store,
    notifier: deps.notifier,
    webOrigin: deps.webOrigin,
    secureCookies: deps.secureCookies ?? false,
    prefix: "/api/portal",
  });
  await typed.register(deadlineRoutes, { db: deps.db, ctx, idempotent, prefix: "/api/v1" });
  await typed.register(documentRoutes, {
    db: deps.db,
    store: deps.store,
    ctx,
    idempotent,
    prefix: "/api/v1",
  });
  if (!deps.production) app.get("/openapi.json", { schema: { hide: true } }, () => app.swagger());

  // In production the API container also serves the built React app.
  if (deps.webDist) {
    // Built files have content hashes in their names, so browsers may keep them for a year.
    // index.html is checked on every visit, so a release reaches users at once.
    await app.register(fastifyStatic, {
      root: deps.webDist,
      cacheControl: false,
      setHeaders: (res, path) =>
        res.setHeader(
          "cache-control",
          path.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
        ),
    });
    app.setNotFoundHandler((request, reply) =>
      request.url.startsWith("/api/")
        ? reply
            .code(404)
            .type("application/problem+json")
            .send({ code: "not_found", title: "Not found", status: 404 })
        : reply.sendFile("index.html"),
    );
  }

  return app;
}
