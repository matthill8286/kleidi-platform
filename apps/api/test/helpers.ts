import { createHmac, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { createS3Store } from "@kleidi/modules/documents";

export const WEB_ORIGIN = "http://localhost:5180";
export const TEST_SECRET = "test-secret-that-is-at-least-32-characters-long";
export const TEST_PASSWORD = "correct-horse-battery-staple";

/** RFC 6238 TOTP, so tests can complete two-factor setup like an authenticator app would. */
export function totp(secretBase32: string, now = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = secretBase32
    .replace(/=+$/, "")
    .toUpperCase()
    .split("")
    .map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0"))
    .join("");
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

/** A browser-like client: keeps cookies and sends the trusted Origin header. */
export function client(app: FastifyInstance) {
  const jar = new Map<string, string>();
  let firmId: string | null = null;

  async function call(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    url: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ) {
    const res = await app.inject({
      method,
      url,
      headers: {
        origin: WEB_ORIGIN,
        ...(jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
        ...(firmId ? { "x-kleidi-firm": firmId } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...extra,
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    });
    const setCookie = res.headers["set-cookie"];
    for (const raw of Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []) {
      const [pair] = raw.split(";");
      const [name, ...value] = pair!.split("=");
      jar.set(name!.trim(), value.join("="));
    }
    return res;
  }

  return {
    get: (url: string, headers?: Record<string, string>) => call("GET", url, undefined, headers),
    post: (url: string, body: unknown = {}, headers?: Record<string, string>) =>
      call("POST", url, body, headers),
    patch: (url: string, body: unknown = {}) => call("PATCH", url, body),
    delete: (url: string) => call("DELETE", url),
    useFirm: (id: string) => {
      firmId = id;
    },
  };
}

export const uniqueEmail = (name: string) =>
  `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}.${randomUUID().slice(0, 8)}@example.test`;

/** Signs up and completes authenticator-app setup, returning a fully enrolled client. */
export async function enrolledUser(app: FastifyInstance, name: string, email = uniqueEmail(name)) {
  const c = client(app);
  const signUp = await c.post("/api/auth/sign-up/email", { name, email, password: TEST_PASSWORD });
  if (signUp.statusCode !== 200)
    throw new Error(`sign-up failed: ${signUp.statusCode} ${signUp.body}`);
  const enable = await c.post("/api/auth/two-factor/enable", { password: TEST_PASSWORD });
  if (enable.statusCode !== 200)
    throw new Error(`2FA enable failed: ${enable.statusCode} ${enable.body}`);
  const secret = new URL(enable.json().totpURI).searchParams.get("secret")!;
  const verify = await c.post("/api/auth/two-factor/verify-totp", { code: totp(secret) });
  if (verify.statusCode !== 200)
    throw new Error(`2FA verify failed: ${verify.statusCode} ${verify.body}`);
  return { c, email, name };
}

/** Local object storage; tests sign links for the storage host directly, without the proxy. */
export const testStore = () =>
  createS3Store({
    endpoint: process.env.S3_ENDPOINT ?? "http://localhost:8333",
    publicEndpoint: process.env.S3_ENDPOINT ?? "http://localhost:8333",
    region: process.env.S3_REGION ?? "fr-par",
    bucket: process.env.S3_BUCKET ?? "kleidi-documents",
    accessKeyId: process.env.S3_ACCESS_KEY ?? "kleidi",
    secretAccessKey: process.env.S3_SECRET_KEY ?? "kleidi-dev-secret",
  });
