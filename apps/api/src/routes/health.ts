import { sql } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Db } from "@kleidi/db";

export const healthRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.get(
    "/health",
    {
      schema: {
        response: {
          200: z.object({ status: z.literal("ok"), database: z.literal("ok") }),
          503: z.object({ status: z.literal("degraded"), database: z.literal("down") }),
        },
      },
    },
    async (_request, reply) => {
      try {
        await db.execute(sql`select 1`);
        return { status: "ok" as const, database: "ok" as const };
      } catch {
        return reply.code(503).send({ status: "degraded", database: "down" });
      }
    },
  );
};
