import { describe, expect, it } from "vitest";
import { hasActiveConsent, type ConsentRecord } from "./consent.ts";

const granted: ConsentRecord = {
  granteeType: "agent",
  granteeRef: "agency-1",
  scope: "status",
  revokedAt: null,
};

describe("hasActiveConsent", () => {
  it("allows the named grantee while consent stands", () => {
    expect(hasActiveConsent([granted], { type: "agent", ref: "agency-1" })).toBe(true);
  });

  it("denies other grantees and revoked consent", () => {
    expect(hasActiveConsent([granted], { type: "agent", ref: "agency-2" })).toBe(false);
    expect(hasActiveConsent([granted], { type: "bank", ref: "agency-1" })).toBe(false);
    const revoked = { ...granted, revokedAt: new Date() };
    expect(hasActiveConsent([revoked], { type: "agent", ref: "agency-1" })).toBe(false);
  });
});
