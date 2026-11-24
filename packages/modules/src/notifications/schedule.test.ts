import { describe, expect, it } from "vitest";
import { localDay, localHour } from "./schedule.ts";

describe("local time for scheduled messages", () => {
  // 05:00 UTC in January is 07:00 in Nicosia and 05:00 in London.
  const winter = new Date("2027-01-15T05:00:00Z");
  // 06:00 UTC in July is 09:00 in Nicosia (summer time) and 07:00 in London.
  const summer = new Date("2027-07-15T06:00:00Z");

  it("reads the hour in each time zone, including summer time", () => {
    expect(localHour(winter, "Asia/Nicosia")).toBe(7);
    expect(localHour(winter, "Europe/London")).toBe(5);
    expect(localHour(summer, "Asia/Nicosia")).toBe(9);
    expect(localHour(summer, "Europe/London")).toBe(7);
  });

  it("reads the calendar day in each time zone", () => {
    // 23:30 UTC on 31 December is already New Year's Day in Nicosia.
    const lateNight = new Date("2026-12-31T23:30:00Z");
    expect(localDay(lateNight, "Asia/Nicosia")).toBe("2027-01-01");
    expect(localDay(lateNight, "Europe/London")).toBe("2026-12-31");
  });
});
