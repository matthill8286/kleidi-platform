import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import swagger from "@fastify/swagger";
import Fastify from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { Db } from "@kleidi/db";
import type { Auth } from "@kleidi/modules/identity";
import { registerAuthRoutes } from "./plugins/auth-routes.ts";
import { createContext } from "./plugins/context.ts";
import { registerErrorHandler } from "./plugins/errors.ts";
import { firmRoutes } from "./routes/firms.ts";
import { healthRoutes } from "./routes/health.ts";
import { invitationRoutes } from "./routes/invitations.ts";
import { jurisdictionRoutes } from "./routes/jurisdictions.ts";
import { meRoutes } from "./routes/me.ts";

export type AppDeps = {
  db: Db;
  auth: Auth;
  webOrigin: string;
  webDist?: string | undefined;
  logger?: boolean;
};

export async function buildApp(deps: AppDeps) {
  const app = Fastify({ logger: deps.logger ?? false, trustProxy: true });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'self'"], frameAncestors: ["'none'"], objectSrc: ["'none'"] },
    },
  });
  await app.register(cors, { origin: deps.webOrigin, credentials: true });
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
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
  await typed.register(firmRoutes, { db: deps.db, ctx, prefix: "/api/v1" });
  await typed.register(invitationRoutes, { db: deps.db, ctx, prefix: "/api/v1" });
  app.get("/openapi.json", { schema: { hide: true } }, () => app.swagger());

  // In production the API container also serves the built React app.
  if (deps.webDist) {
    await app.register(fastifyStatic, { root: deps.webDist });
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
