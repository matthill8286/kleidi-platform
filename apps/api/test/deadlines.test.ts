import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "@kleidi/db";
import { createAuth } from "@kleidi/modules/identity";
import { buildApp } from "../src/app.ts";
import { enrolledUser, TEST_SECRET, testStore, WEB_ORIGIN } from "./helpers.ts";

const inHours = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000).toISOString();

// Integration: deadline and profile routes against the local Postgres.
describe.skipIf(!process.env.DATABASE_URL)("deadlines and profile", () => {
  const { db, close } = createDb(process.env.DATABASE_URL ?? "", { max: 4 });
  let app: FastifyInstance;

  beforeAll(async () => {
    const auth = createAuth({
      db,
      baseURL: WEB_ORIGIN,
      secret: TEST_SECRET,
      trustedOrigins: [WEB_ORIGIN],
    });
    app = await buildApp({ db, auth, webOrigin: WEB_ORIGIN, store: testStore() });
  });
  afterAll(async () => {
    await app.close();
    await close();
  });

  async function lawyerWithCase(name: string) {
    const { c } = await enrolledUser(app, name);
    c.useFirm((await c.post("/api/v1/firms", { name: `${name} Law` })).json().id);
    const created = await c.post("/api/v1/cases", {
      propertyAddress: "9 Makariou Ave, Limassol",
      propertyType: "offplan",
      parties: [{ role: "buyer", fullName: "Olga Smirnova" }],
    });
    return { c, caseId: created.json().id as string };
  }

  it("adds, lists, reschedules, completes and removes deadlines", async () => {
    const { c, caseId } = await lawyerWithCase("Deadline Keeper");
    const soon = await c.post(`/api/v1/cases/${caseId}/deadlines`, {
      title: "Stamp duty",
      dueAt: inHours(5),
    });
    expect(soon.statusCode).toBe(201);
    await c.post(`/api/v1/cases/${caseId}/deadlines`, {
      title: "Deposit contract at Land Registry",
      dueAt: inHours(24 * 20),
      remindBeforeHours: [168, 24],
    });

    let list = (await c.get(`/api/v1/deadlines?caseId=${caseId}`)).json();
    expect(list.map((d: { title: string }) => d.title)).toEqual([
      "Stamp duty",
      "Deposit contract at Land Registry",
    ]);
    expect(list[1]).toMatchObject({
      urgency: "later",
      remindBeforeHours: [168, 24],
      owner: { name: "Deadline Keeper" },
    });

    const id = soon.json().id;
    expect((await c.patch(`/api/v1/deadlines/${id}`, { dueAt: inHours(48) })).statusCode).toBe(204);
    expect((await c.patch(`/api/v1/deadlines/${id}`, { done: true })).statusCode).toBe(204);
    list = (await c.get(`/api/v1/deadlines?mine=true`)).json();
    expect(list.map((d: { title: string }) => d.title)).toEqual([
      "Deposit contract at Land Registry",
    ]);
    const all = (await c.get(`/api/v1/deadlines?includeDone=true`)).json();
    expect(all.at(-1)).toMatchObject({ title: "Stamp duty", urgency: "done" });

    expect((await c.delete(`/api/v1/deadlines/${id}`)).statusCode).toBe(204);
    expect((await c.get(`/api/v1/deadlines?includeDone=true`)).json()).toHaveLength(1);
  });

  it("refuses a deadline in the past, with a translatable message", async () => {
    const { c, caseId } = await lawyerWithCase("Late Lawyer");
    const res = await c.post(`/api/v1/cases/${caseId}/deadlines`, {
      title: "Too late",
      dueAt: inHours(-1),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().messageKey).toBe("deadlinePast");
  });

  it("keeps deadlines inside the firm", async () => {
    const { c, caseId } = await lawyerWithCase("Private Deadlines");
    const id = (
      await c.post(`/api/v1/cases/${caseId}/deadlines`, { title: "Secret", dueAt: inHours(30) })
    ).json().id;
    const { c: outsider } = await lawyerWithCase("Prying Firm");
    expect((await outsider.get("/api/v1/deadlines")).json()).toHaveLength(0);
    expect((await outsider.patch(`/api/v1/deadlines/${id}`, { done: true })).statusCode).toBe(404);
    expect(
      (
        await outsider.post(`/api/v1/cases/${caseId}/deadlines`, {
          title: "Nope",
          dueAt: inHours(30),
        })
      ).statusCode,
    ).toBe(404);
  });

  it("saves language, phone and SMS choice, and checks the number", async () => {
    const { c } = await enrolledUser(app, "Profile Owner");
    expect((await c.patch("/api/v1/me", { smsReminders: true })).json().messageKey).toBe(
      "phoneNeeded",
    );
    expect((await c.patch("/api/v1/me", { phone: "99 123" })).json().messageKey).toBe(
      "phoneInvalid",
    );
    expect(
      (await c.patch("/api/v1/me", { locale: "ru", phone: "+357 99 123456", smsReminders: true }))
        .statusCode,
    ).toBe(204);
    expect((await c.get("/api/v1/me")).json().user).toMatchObject({
      locale: "ru",
      phone: "+35799123456",
      smsReminders: true,
    });
  });
});
