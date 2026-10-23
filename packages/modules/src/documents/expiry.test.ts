import { describe, expect, it } from "vitest";
import { expiryStatus } from "./expiry.ts";

const today = new Date("2026-10-09T15:00:00Z");

describe("expiryStatus", () => {
  it.each([
    [null, "no_expiry"],
    ["2026-10-08", "expired"],
    ["2026-10-09", "expiring"],
    ["2026-10-16", "expiring"],
    ["2026-10-17", "valid"],
    // A charges search uploaded today with its 30-day expiry.
    ["2026-11-08", "valid"],
  ] as const)("%s is %s", (expiresOn, expected) => {
    expect(expiryStatus(expiresOn, today)).toBe(expected);
  });
});
