import type { FastifyError, FastifyInstance } from "fastify";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";
import { AppError } from "@kleidi/kernel";

const problem = (code: string, title: string, status: number, detail?: unknown) => ({
  type: `https://kleidi.cy/problems/${code}`,
  title,
  status,
  code,
  ...(detail === undefined ? {} : { detail }),
});

/** Every error leaves as an RFC 9457 problem document with a stable `code`. */
export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    reply.type("application/problem+json");
    if (error instanceof AppError) {
      return reply.code(error.status).send(problem(error.code, error.message, error.status));
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply
        .code(422)
        .send(problem("invalid", "The request is not valid", 422, error.validation));
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply
        .code(error.statusCode)
        .send(problem("request_error", error.message, error.statusCode));
    }
    request.log.error(error);
    return reply.code(500).send(problem("internal", "Something went wrong", 500));
  });
}
