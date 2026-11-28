import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, schema } from "@kleidi/db";
import { AppError } from "@kleidi/kernel";
import { hasPendingInvitation } from "@kleidi/modules/firms";
import { createAuth, LICENCE_HEADER } from "@kleidi/modules/identity";
import {
  mayStartLicence,
  type Licence,
  type LicenceStatus,
  type Licensing,
} from "@kleidi/modules/licensing";
import { buildApp } from "../src/app.ts";
import {
  client,
  enrolledUser,
  sendResetPasswordEmail,
  sendVerificationEmail,
  TEST_PASSWORD,
  TEST_SECRET,
  testNotifier,
  testStore,
  uniqueEmail,
  WEB_ORIGIN,
} from "./helpers.ts";

const NEW_CASE = {
  propertyAddress: "Apt 12, Seaview Court, Limassol",
  propertyType: "resale",
  parties: [{ role: "buyer", fullName: "Anna Petrova", email: "anna@example.test" }],
};

/** The account service's licences, held in memory, so tests can issue and change them. */
function fakeAccountService() {
  const licences = new Map<string, Licence>();
  const licensing: Licensing = {
    enabled: true,
    forFirm: async (firmId) => [...licences.values()].find((l) => l.tenant === firmId) ?? null,
    byId: async (id) => licences.get(id) ?? null,
    bind: async (id, firmId) => {
      const licence = licences.get(id);
      if (!licence || (licence.tenant && licence.tenant !== firmId)) {
        throw new AppError("conflict", "This licence has already been used", "licenceUsed");
      }
      licence.tenant = firmId;
      return licence;
    },
  };
  return {
    licensing,
    issue(owner: string, over: Partial<Licence> = {}): Licence {
      const licence: Licence = {
        id: randomUUID(),
        plan: "firm",
        status: "active",
        seats: null,
        limits: {},
        endsAt: null,
        graceEndsAt: null,
        readOnlyEndsAt: null,
        tenant: null,
        owners: [owner],
        ...over,
      };
      licences.set(licence.id, licence);
      return licence;
    },
    set(id: string, status: LicenceStatus) {
      licences.get(id)!.status = status;
    },
  };
}

// Integration: Kleidi with licences checked, as on a server, against the local Postgres.
describe.skipIf(!process.env.DATABASE_URL || !process.env.DATABASE_ADMIN_URL)("licences", () => {
  const { db, close } = createDb(process.env.DATABASE_URL ?? "", { max: 4 });
  const admin = createDb(process.env.DATABASE_ADMIN_URL ?? "", { max: 1 });
  const account = fakeAccountService();
  let app: FastifyInstance;

  beforeAll(async () => {
    const auth = createAuth({
      db,
      baseURL: WEB_ORIGIN,
      secret: TEST_SECRET,
      trustedOrigins: [WEB_ORIGIN],
      sendVerificationEmail,
      sendResetPasswordEmail,
      // The same rule as the server: people a firm invited, and people a licence names.
      maySignUp: async ({ email, licenceId }) =>
        (await hasPendingInvitation(db, email)) ||
        (await mayStartLicence(account.licensing, licenceId, email)),
    });
    app = await buildApp({
      db,
      auth,
      webOrigin: WEB_ORIGIN,
      store: testStore(),
      notifier: testNotifier(),
      licensing: account.licensing,
    });
  });
  afterAll(async () => {
    await app.close();
    await Promise.all([close(), admin.close()]);
  });

  /** The invitation link's token, which travels only in the outbox event that gets emailed. */
  async function invitationToken(email: string) {
    const events = await admin.db
      .select()
      .from(schema.outbox)
      .where(eq(schema.outbox.type, "firms.MemberInvited"))
      .orderBy(desc(schema.outbox.occurredAt))
      .limit(50);
    const found = events
      .map((e) => e.payload as { email: string; token: string })
      .find((p) => p.email === email);
    if (!found) throw new Error(`no invitation event for ${email}`);
    return found.token;
  }

  /** A customer with a licence, signed up from the licence link, with their firm set up. */
  async function licensedFirm(name: string, over: Partial<Licence> = {}) {
    const email = uniqueEmail(name);
    const licence = account.issue(email, over);
    const { c } = await enrolledUser(app, name, email, { [LICENCE_HEADER]: licence.id });
    const firm = await c.post("/api/v1/firms", { name: `${name} Law`, licenceId: licence.id });
    expect(firm.statusCode).toBe(201);
    c.useFirm(firm.json().id);
    return { c, email, licence, firmId: firm.json().id as string };
  }

  const signUp = (email: string, headers: Record<string, string> = {}) =>
    client(app).post(
      "/api/auth/sign-up/email",
      { name: "Someone", email, password: TEST_PASSWORD },
      headers,
    );

  // ---------------------------------------------------------------- sign-up

  it("refuses a stranger who signs up", async () => {
    const res = await signUp(uniqueEmail("stranger"));
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("SIGN_UP_CLOSED");
  });

  it("refuses sign-up with a licence issued to someone else, or one that is used or made up", async () => {
    const other = account.issue(uniqueEmail("owner"));
    const header = (id: string) => ({ [LICENCE_HEADER]: id });
    expect((await signUp(uniqueEmail("thief"), header(other.id))).statusCode).toBe(403);
    expect((await signUp(uniqueEmail("guess"), header(randomUUID()))).statusCode).toBe(403);
    expect((await signUp(uniqueEmail("junk"), header("not-a-licence"))).statusCode).toBe(403);
    const used = await licensedFirm("Used Licence");
    expect((await signUp(uniqueEmail("late"), header(used.licence.id))).statusCode).toBe(403);
  });

  it("lets the person a licence names sign up, whatever the case of their address", async () => {
    const email = uniqueEmail("named");
    const licence = account.issue(email);
    const res = await signUp(email.toUpperCase(), { [LICENCE_HEADER]: licence.id });
    expect(res.statusCode).toBe(200);
  });

  it("lets a person a firm has invited sign up, and nobody else at that firm's request", async () => {
    const { c } = await licensedFirm("Inviting Firm");
    const invited = uniqueEmail("colleague");
    const invite = await c.post("/api/v1/team/invitations", { email: invited, role: "lawyer" });
    expect(invite.statusCode).toBe(201);
    expect((await signUp(invited)).statusCode).toBe(200);
    expect((await signUp(uniqueEmail("uninvited"))).statusCode).toBe(403);
  });

  // ---------------------------------------------------------------- setting a firm up

  it("sets a firm up under its licence, once, and binds the licence to it", async () => {
    const { c, licence, firmId } = await licensedFirm("Georgiou");
    // The firm takes the licence's id, so a retry after a failure finishes the same firm.
    expect(firmId).toBe(licence.id);
    expect(licence.tenant).toBe(firmId);
    const again = await c.post("/api/v1/firms", { name: "Second Firm", licenceId: licence.id });
    expect(again.statusCode).toBe(403);
    expect(again.json().messageKey).toBe("licenceUsed");
    const me = (await c.get("/api/v1/me")).json();
    expect(me.firms).toEqual([expect.objectContaining({ id: firmId, access: "full" })]);
  });

  it("refuses a firm without a licence, with someone else's, or with one that is not active", async () => {
    const email = uniqueEmail("no-firm");
    const mine = account.issue(email, { status: "suspended" });
    const { c } = await enrolledUser(app, "No Firm", email, {
      [LICENCE_HEADER]: account.issue(email).id,
    });
    const create = async (licenceId?: string) => {
      const res = await c.post("/api/v1/firms", { name: "Wishful & Co", licenceId });
      expect(res.statusCode).toBe(403);
      return res.json().messageKey as string;
    };
    expect(await create()).toBe("licenceNotFound");
    expect(await create(randomUUID())).toBe("licenceNotFound");
    expect(await create(account.issue(uniqueEmail("other")).id)).toBe("licenceNotYours");
    expect(await create(mine.id)).toBe("licenceNotActive");
    expect((await c.get("/api/v1/me")).json().firms).toEqual([]);
  });

  it("makes no firm when the licence cannot be bound", async () => {
    const email = uniqueEmail("raced");
    const licence = account.issue(email);
    const { c } = await enrolledUser(app, "Raced", email, { [LICENCE_HEADER]: licence.id });
    const bind = account.licensing.bind;
    account.licensing.bind = async () => {
      throw new AppError("unavailable", "The account service is down", "licenceUnavailable");
    };
    try {
      const res = await c.post("/api/v1/firms", { name: "Raced Law", licenceId: licence.id });
      expect(res.statusCode).toBe(503);
    } finally {
      account.licensing.bind = bind;
    }
    expect((await c.get("/api/v1/me")).json().firms).toEqual([]);
    // The same request again finishes the firm.
    const retry = await c.post("/api/v1/firms", { name: "Raced Law", licenceId: licence.id });
    expect(retry.statusCode).toBe(201);
  });

  // ---------------------------------------------------------------- what a status allows

  it("lets a read-only firm read and refuses every change", async () => {
    const { c, licence, firmId } = await licensedFirm("Lapsed");
    expect((await c.post("/api/v1/cases", NEW_CASE)).statusCode).toBe(201);
    account.set(licence.id, "read_only");
    expect((await c.get("/api/v1/cases")).statusCode).toBe(200);
    expect((await c.get("/api/v1/team")).statusCode).toBe(200);
    const write = await c.post("/api/v1/cases", NEW_CASE);
    expect(write.statusCode).toBe(403);
    expect(write.json().messageKey).toBe("licenceReadOnly");
    const invite = await c.post("/api/v1/team/invitations", {
      email: uniqueEmail("late"),
      role: "staff",
    });
    expect(invite.json().messageKey).toBe("licenceReadOnly");
    const me = (await c.get("/api/v1/me")).json();
    expect(me.firms).toEqual([expect.objectContaining({ id: firmId, access: "read" })]);
  });

  it("works fully in the grace period and says when it ends", async () => {
    const { c, licence } = await licensedFirm("Grace");
    account.set(licence.id, "grace");
    licence.graceEndsAt = "2027-01-15T00:00:00.000Z";
    expect((await c.post("/api/v1/cases", NEW_CASE)).statusCode).toBe(201);
    const me = (await c.get("/api/v1/me")).json();
    expect(me.firms[0]).toMatchObject({ access: "full", ending: "2027-01-15T00:00:00.000Z" });
  });

  it("refuses a suspended or expired firm everything, and lets its people still sign in", async () => {
    const { c, licence } = await licensedFirm("Stopped");
    for (const status of ["suspended", "expired", "pending"] as const) {
      account.set(licence.id, status);
      const read = await c.get("/api/v1/cases");
      expect(read.statusCode).toBe(403);
      expect(read.json().messageKey).toBe("licenceInactive");
    }
    const me = await c.get("/api/v1/me");
    expect(me.statusCode).toBe(200);
    expect(me.json().firms[0].access).toBe("none");
    account.set(licence.id, "active");
    expect((await c.get("/api/v1/cases")).statusCode).toBe(200);
  });

  it("refuses a firm that has no licence at all", async () => {
    const { c, licence } = await licensedFirm("Unbound");
    licence.tenant = null;
    const res = await c.get("/api/v1/cases");
    expect(res.statusCode).toBe(403);
    expect(res.json().messageKey).toBe("licenceInactive");
  });

  // ---------------------------------------------------------------- limits

  it("stops inviting once every seat is taken or promised", async () => {
    const { c } = await licensedFirm("Two Seats", { seats: 2 });
    const invite = (email: string) => c.post("/api/v1/team/invitations", { email, role: "lawyer" });
    const first = uniqueEmail("first");
    expect((await invite(first)).statusCode).toBe(201);
    // Inviting the same person again does not need another seat.
    expect((await invite(first)).statusCode).toBe(201);
    const full = await invite(uniqueEmail("second"));
    expect(full.statusCode).toBe(409);
    expect(full.json().messageKey).toBe("seatsFull");
  });

  it("puts no limit on people when the licence names no seats", async () => {
    const { c } = await licensedFirm("Unlimited");
    for (let i = 0; i < 4; i++) {
      const res = await c.post("/api/v1/team/invitations", {
        email: uniqueEmail(`person${i}`),
        role: "staff",
      });
      expect(res.statusCode).toBe(201);
    }
  });

  it("refuses an invited person the seat when the licence was cut after they were invited", async () => {
    const { c, licence } = await licensedFirm("Cut Back", { seats: 2 });
    const email = uniqueEmail("joiner");
    expect((await c.post("/api/v1/team/invitations", { email, role: "lawyer" })).statusCode).toBe(
      201,
    );
    const token = await invitationToken(email);
    licence.seats = 1;
    const joiner = await enrolledUser(app, "Joiner", email);
    const refused = await joiner.c.post(`/api/v1/invitations/${token}/accept`);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().messageKey).toBe("seatsFull");
    licence.seats = 2;
    expect((await joiner.c.post(`/api/v1/invitations/${token}/accept`)).statusCode).toBe(200);
  });

  it("stops opening sales at the number the licence covers", async () => {
    const { c } = await licensedFirm("Pilot", { limits: { casesOpened: 2 } });
    expect((await c.post("/api/v1/cases", NEW_CASE)).statusCode).toBe(201);
    expect((await c.post("/api/v1/cases", NEW_CASE)).statusCode).toBe(201);
    const third = await c.post("/api/v1/cases", NEW_CASE);
    expect(third.statusCode).toBe(409);
    expect(third.json().messageKey).toBe("caseLimitReached");
  });
});
