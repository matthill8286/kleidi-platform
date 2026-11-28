import { describe, expect, it } from "vitest";
import {
  accessFor,
  caseLimit,
  hasFreeSeat,
  isReadMethod,
  setUpRefusal,
  type Licence,
  type LicenceStatus,
} from "./domain.ts";

const licence = (over: Partial<Licence> = {}): Licence => ({
  id: "2f1c9a34-5b6d-4e7f-8a90-b1c2d3e4f506",
  plan: "firm",
  status: "active",
  seats: null,
  limits: {},
  endsAt: null,
  graceEndsAt: null,
  readOnlyEndsAt: null,
  tenant: null,
  owners: ["maria@georgiou.test"],
  ...over,
});

describe("what a licence allows", () => {
  it("gives full use while active or in grace, reading when read-only, and nothing otherwise", () => {
    const access = (status: LicenceStatus) => accessFor(licence({ status }));
    expect(access("active")).toBe("full");
    expect(access("grace")).toBe("full");
    expect(access("read_only")).toBe("read");
    expect(access("pending")).toBe("none");
    expect(access("expired")).toBe("none");
    expect(access("suspended")).toBe("none");
  });

  it("gives a firm with no licence nothing", () => {
    expect(accessFor(null)).toBe("none");
  });

  it("treats GET, HEAD and OPTIONS as reading", () => {
    expect(["GET", "head", "OPTIONS"].every(isReadMethod)).toBe(true);
    expect(["POST", "PATCH", "PUT", "DELETE"].some(isReadMethod)).toBe(false);
  });
});

describe("who may set a firm up under a licence", () => {
  it("lets an owner of an unused, active licence, whatever the case of their address", () => {
    expect(setUpRefusal(licence(), " Maria@Georgiou.test ")).toBeNull();
    expect(setUpRefusal(licence({ status: "grace" }), "maria@georgiou.test")).toBeNull();
  });

  it("says why everyone else may not", () => {
    expect(setUpRefusal(null, "maria@georgiou.test")).toBe("licenceNotFound");
    expect(setUpRefusal(licence({ tenant: "firm-1" }), "maria@georgiou.test")).toBe("licenceUsed");
    expect(setUpRefusal(licence({ status: "suspended" }), "maria@georgiou.test")).toBe(
      "licenceNotActive",
    );
    expect(setUpRefusal(licence({ status: "read_only" }), "maria@georgiou.test")).toBe(
      "licenceNotActive",
    );
    expect(setUpRefusal(licence(), "someone@else.test")).toBe("licenceNotYours");
  });
});

describe("limits", () => {
  it("counts pending invitations against the seats", () => {
    expect(hasFreeSeat(null, 500, 500)).toBe(true);
    expect(hasFreeSeat(3, 2)).toBe(true);
    expect(hasFreeSeat(3, 2, 1)).toBe(false);
    expect(hasFreeSeat(3, 3)).toBe(false);
  });

  it("reads the sales a licence covers, with no limit when it names none", () => {
    expect(caseLimit(licence({ limits: { casesOpened: 5 } }))).toBe(5);
    expect(caseLimit(licence())).toBeNull();
    expect(caseLimit(null)).toBeNull();
  });
});
