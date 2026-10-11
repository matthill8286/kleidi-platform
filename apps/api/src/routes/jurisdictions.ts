import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Db } from "@kleidi/db";
import { AppError } from "@kleidi/kernel";
import { getTemplate } from "@kleidi/modules/jurisdictions";

const Localised = z.object({ en: z.string(), el: z.string(), ru: z.string() });

const JurisdictionTemplate = z.object({
  code: z.string(),
  stages: z.array(z.object({ key: z.string(), label: Localised })),
  requirements: z.array(
    z.object({
      key: z.string(),
      stageKey: z.string(),
      label: Localised,
      help: Localised,
      expiryDays: z.number().nullable(),
    }),
  ),
});

// Reference data only: stages and document requirements per country. No client data.
export const jurisdictionRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.get(
    "/jurisdictions/:code/template",
    {
      schema: {
        params: z.object({ code: z.string().length(2).toUpperCase() }),
        response: { 200: JurisdictionTemplate },
      },
    },
    async (request) => {
      const template = await getTemplate(db, request.params.code);
      if (template.stages.length === 0)
        throw new AppError("not_found", `No template for ${request.params.code}`);
      return template;
    },
  );
};
