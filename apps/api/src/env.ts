import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  API_PORT: z.coerce.number().int().default(4100),
  WEB_ORIGIN: z.string().url().default("http://localhost:5180"),
  WEB_DIST: z.string().optional(),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
  // Scaleway Serverless Containers sit behind one proxy.
  TRUSTED_PROXIES: z.coerce.number().int().min(0).default(0),
  // Comma-separated emails allowed to create a firm. Unset means anyone may (local only).
  FIRM_CREATORS: z.string().optional(),
  // The Impakt account service, which holds each firm's licence: its address on the private
  // network and Kleidi's service token there. With both set, Kleidi is closed to sign-up and a
  // firm works only under a licence. Unset, licences are not checked (local only).
  ACCOUNT_INTERNAL_URL: z.string().url().optional(),
  ACCOUNT_TOKEN: z.string().min(32).optional(),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  S3_ENDPOINT: z.string().url(),
  // The host browsers use for signed links; locally the Vite proxy forwards it to storage.
  S3_PUBLIC_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default("fr-par"),
  S3_BUCKET: z.string(),
  S3_ACCESS_KEY: z.string(),
  S3_SECRET_KEY: z.string(),
  // Kleidi Assist explains documents in English. Unset turns the feature off.
  ASSIST_URL: z.string().url().optional(),
  ASSIST_API_KEY: z.string().optional(),
});

/** The emails allowed to create a firm, or undefined when anyone may (unset or empty). */
export function firmCreators(env: Env): string[] | undefined {
  const list = (env.FIRM_CREATORS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.length > 0 ? list : undefined;
}

/** Where to read licences from, or undefined when licences are not checked. */
export function licensingConfig(env: Env): { url: string; token: string } | undefined {
  if (!env.ACCOUNT_INTERNAL_URL && !env.ACCOUNT_TOKEN) return undefined;
  if (!env.ACCOUNT_INTERNAL_URL || !env.ACCOUNT_TOKEN) {
    throw new Error("Set both ACCOUNT_INTERNAL_URL and ACCOUNT_TOKEN, or neither.");
  }
  return { url: env.ACCOUNT_INTERNAL_URL, token: env.ACCOUNT_TOKEN };
}

export const storageConfig = (env: Env) => ({
  endpoint: env.S3_ENDPOINT,
  publicEndpoint: env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT,
  region: env.S3_REGION,
  bucket: env.S3_BUCKET,
  accessKeyId: env.S3_ACCESS_KEY,
  secretAccessKey: env.S3_SECRET_KEY,
});

export type Env = z.infer<typeof Env>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return Env.parse(source);
}
