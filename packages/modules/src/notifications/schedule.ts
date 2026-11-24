/** The hour (0-23) on the wall clock in a time zone. */
export function localHour(now: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" })
    .formatToParts(now)
    .find((p) => p.type === "hour")!.value;
  return Number(hour);
}

/** The calendar day (YYYY-MM-DD) in a time zone. */
export function localDay(now: Date, timeZone: string): string {
  return now.toLocaleDateString("en-CA", { timeZone });
}
