import { describe, expect, it } from "vitest";
import { expiryStatus } from "./expiry.ts";

const today = new Date("2026-10-09T15:00:00Z");

describe("expiryStatus", () => {
  it.each([
    [null, "no_expiry"],
    ["2026-10-08", "expired"],
    ["2026-10-09", "expiring"],
    ["2026-11-08", "expiring"],
    ["2026-11-09", "valid"],
  ] as const)("%s is %s", (expiresOn, expected) => {
    expect(expiryStatus(expiresOn, today)).toBe(expected);
  });
});
