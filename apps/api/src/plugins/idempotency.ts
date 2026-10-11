import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  releaseIdempotencyKey,
  type Db,
} from "@kleidi/db";
import { AppError } from "@kleidi/kernel";

export const IDEMPOTENCY_HEADER = "idempotency-key";

type Result = { status: number; body: unknown; headers?: Record<string, string> };

/**
 * Runs a write at most once per Idempotency-Key. A retry with the same key and body gets
 * the first response back; the same key with a different body is rejected.
 */
export function createIdempotency(db: Db) {
  return async function idempotent(
    request: FastifyRequest,
    reply: FastifyReply,
    userId: string,
    run: () => Promise<Result>,
  ) {
    const key = request.headers[IDEMPOTENCY_HEADER];
    if (key === undefined) return send(reply, await run());
    if (typeof key !== "string" || key.length < 8 || key.length > 200) {
      throw new AppError("invalid", "The Idempotency-Key header must be 8 to 200 characters");
    }

    const hash = createHash("sha256")
      .update(
        JSON.stringify([
          request.method,
          request.url,
          request.headers["if-match"] ?? null,
          request.body ?? null,
        ]),
      )
      .digest("hex");
    const claim = await claimIdempotencyKey(db, userId, key, hash);
    if (claim.kind === "mismatch") {
      throw new AppError(
        "invalid",
        "This Idempotency-Key was already used for a different request",
      );
    }
    if (claim.kind === "in_progress") {
      throw new AppError("conflict", "A request with this Idempotency-Key is still running");
    }
    if (claim.kind === "replay") {
      const stored = claim.response as { body: unknown; headers?: Record<string, string> };
      // The stored body is already JSON, so it skips the route's response serializer.
      return reply
        .code(claim.statusCode)
        .headers({ ...stored.headers, "idempotent-replayed": "true" })
        .type("application/json")
        .serializer((payload: unknown) => JSON.stringify(payload))
        .send(stored.body);
    }

    try {
      const result = await run();
      const json = JSON.parse(JSON.stringify(result.body)) as unknown;
      await completeIdempotencyKey(db, claim.id, result.status, {
        body: json,
        headers: result.headers,
      });
      return send(reply, result);
    } catch (error) {
      await releaseIdempotencyKey(db, claim.id);
      throw error;
    }
  };
}

function send(reply: FastifyReply, result: Result) {
  return reply
    .code(result.status)
    .headers(result.headers ?? {})
    .send(result.body);
}

export type Idempotent = ReturnType<typeof createIdempotency>;
