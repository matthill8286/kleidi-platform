import type { FastifyError, FastifyInstance } from "fastify";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";
import { AppError } from "@kleidi/kernel";

const problem = (
  code: string,
  title: string,
  status: number,
  extra: { detail?: unknown; messageKey?: string | undefined; params?: unknown } = {},
) => ({
  type: `https://kleidi.cy/problems/${code}`,
  title,
  status,
  code,
  ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined)),
});

/** Every error leaves as an RFC 9457 problem document with a stable `code`. */
export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    reply.type("application/problem+json");
    if (error instanceof AppError) {
      // messageKey and params let the web app show the message in the reader's language.
      return reply.code(error.status).send(
        problem(error.code, error.message, error.status, {
          messageKey: error.key,
          params: error.params,
        }),
      );
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.code(422).send(
        problem("invalid", "The request is not valid", 422, {
          detail: error.validation,
          messageKey: "invalidRequest",
        }),
      );
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
