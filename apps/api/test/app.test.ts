import { afterAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@kleidi/db";
import { createAuth } from "@kleidi/modules/identity";
import { buildApp } from "../src/app.ts";
import {
  TEST_SECRET,
  WEB_ORIGIN,
  testStore,
  testNotifier,
  sendVerificationEmail,
} from "./helpers.ts";

const unreachableDb = {
  execute: async () => {
    throw new Error("database down");
  },
} as unknown as Db;

const appWith = (db: Db) =>
  buildApp({
    db,
    auth: createAuth({
      db,
      baseURL: WEB_ORIGIN,
      secret: TEST_SECRET,
      trustedOrigins: [WEB_ORIGIN],
      sendVerificationEmail,
    }),
    webOrigin: WEB_ORIGIN,
    store: testStore(),
    notifier: testNotifier(),
  });

describe("api without a database", () => {
  it("reports degraded health and sends security headers", async () => {
    const app = await appWith(unreachableDb);
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: "degraded", database: "down" });
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    await app.close();
  });

  it("publishes an OpenAPI document with the v1 routes", async () => {
    const app = await appWith(unreachableDb);
    const paths = Object.keys(
      (await app.inject({ method: "GET", url: "/openapi.json" })).json().paths,
    );
    expect(paths).toEqual(
      expect.arrayContaining(["/api/v1/me", "/api/v1/firms", "/api/v1/team/invitations"]),
    );
    expect(paths.some((p) => p.startsWith("/api/auth"))).toBe(false);
    await app.close();
  });

  it("answers errors as problem documents", async () => {
    const app = await appWith(unreachableDb);
    const res = await app.inject({ method: "POST", url: "/api/v1/firms", payload: { name: "" } });
    expect(res.statusCode).toBe(422);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json()).toMatchObject({ code: "invalid", status: 422 });
    await app.close();
  });
});

// Integration: needs the local Postgres, migrated and seeded.
describe.skipIf(!process.env.DATABASE_URL)("api with the database", () => {
  const { db, close } = createDb(process.env.DATABASE_URL ?? "", { max: 2 });
  afterAll(close);

  it("returns the Cyprus template in order", async () => {
    const app = await appWith(db);
    const res = await app.inject({ method: "GET", url: "/api/v1/jurisdictions/cy/template" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.stages[0].key).toBe("reservation");
    expect(body.stages.at(-1).key).toBe("completed");
    expect(body.requirements.map((r: { key: string }) => r.key)).toContain("deposited_contract");
    await app.close();
  });
});
