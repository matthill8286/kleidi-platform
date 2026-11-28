import { describe, expect, it } from "vitest";
import { AppError } from "@kleidi/kernel";
import { createLicensing, FRESH_MISSING_MS, FRESH_MS, STALE_MS } from "./client.ts";

const FIRM = "firm-1";
const body = (status: string, tenant: string | null = FIRM) => ({
  licence: {
    id: "lic-1",
    plan: "firm",
    status,
    seats: null,
    limits: {},
    endsAt: null,
    graceEndsAt: null,
    readOnlyEndsAt: null,
    tenant,
    owners: [],
  },
});

/** A stand-in account service whose next answer the test sets, and a clock the test moves. */
function setup() {
  let now = Date.parse("2027-01-01T00:00:00Z");
  const calls: { url: string; init: RequestInit }[] = [];
  let answer: () => Response = () => Response.json(body("active"));
  const licensing = createLicensing({
    url: "http://account:5090/",
    token: "kleidi-token",
    clock: { now: () => new Date(now) },
    fetch: async (url, init) => {
      calls.push({ url, init });
      return answer();
    },
  });
  return {
    licensing,
    calls,
    answer: (next: () => Response) => void (answer = next),
    down: () =>
      void (answer = () => {
        throw new Error("connection refused");
      }),
    pass: (ms: number) => void (now += ms),
  };
}

describe("reading licences from the account service", () => {
  it("asks with Kleidi's token and keeps the answer for five minutes", async () => {
    const s = setup();
    expect((await s.licensing.forFirm(FIRM))?.status).toBe("active");
    expect(s.calls[0]!.url).toBe("http://account:5090/internal/licences?tenant=firm-1");
    expect((s.calls[0]!.init.headers as Record<string, string>).authorization).toBe(
      "Bearer kleidi-token",
    );
    s.answer(() => Response.json(body("suspended")));
    s.pass(FRESH_MS - 1);
    expect((await s.licensing.forFirm(FIRM))?.status).toBe("active");
    expect(s.calls).toHaveLength(1);
    s.pass(1);
    expect((await s.licensing.forFirm(FIRM))?.status).toBe("suspended");
    expect(s.calls).toHaveLength(2);
  });

  it("believes 'no licence' for a minute only, so a newly bound licence takes effect soon", async () => {
    const s = setup();
    s.answer(() => Response.json({ code: "no_licence" }, { status: 404 }));
    expect(await s.licensing.forFirm(FIRM)).toBeNull();
    s.answer(() => Response.json(body("active")));
    s.pass(FRESH_MISSING_MS - 1);
    expect(await s.licensing.forFirm(FIRM)).toBeNull();
    s.pass(1);
    expect((await s.licensing.forFirm(FIRM))?.status).toBe("active");
  });

  it("uses the last answer for a day while the account service is down, then refuses", async () => {
    const s = setup();
    await s.licensing.forFirm(FIRM);
    s.down();
    s.pass(STALE_MS - 1);
    expect((await s.licensing.forFirm(FIRM))?.status).toBe("active");
    s.pass(1);
    await expect(s.licensing.forFirm(FIRM)).rejects.toMatchObject({
      code: "unavailable",
      key: "licenceUnavailable",
    });
  });

  it("treats a server error like an outage, not like 'no licence'", async () => {
    const s = setup();
    await s.licensing.forFirm(FIRM);
    s.answer(() => Response.json({}, { status: 500 }));
    s.pass(FRESH_MS);
    expect((await s.licensing.forFirm(FIRM))?.status).toBe("active");
  });

  it("refuses a firm it has never had an answer for while the account service is down", async () => {
    const s = setup();
    s.down();
    await expect(s.licensing.forFirm(FIRM)).rejects.toBeInstanceOf(AppError);
  });

  it("binds a firm, remembers the licence, and reports a used licence as a conflict", async () => {
    const s = setup();
    s.answer(() => Response.json(body("active")));
    expect((await s.licensing.bind("lic-1", FIRM)).tenant).toBe(FIRM);
    expect(s.calls[0]!.url).toBe("http://account:5090/internal/licences/lic-1/tenant");
    expect(s.calls[0]!.init.body).toBe(JSON.stringify({ tenant: FIRM }));
    // The bind's answer is cached, so the firm's first request does not ask again.
    await s.licensing.forFirm(FIRM);
    expect(s.calls).toHaveLength(1);
    s.answer(() => Response.json({ code: "licence_bound" }, { status: 409 }));
    await expect(s.licensing.bind("lic-1", "firm-2")).rejects.toMatchObject({
      code: "conflict",
      key: "licenceUsed",
    });
  });

  it("reads a licence by id fresh every time", async () => {
    const s = setup();
    s.answer(() => Response.json(body("active", null)));
    expect((await s.licensing.byId("lic-1"))?.tenant).toBeNull();
    await s.licensing.byId("lic-1");
    expect(s.calls).toHaveLength(2);
    s.answer(() => Response.json({}, { status: 404 }));
    expect(await s.licensing.byId("lic-1")).toBeNull();
  });
});
