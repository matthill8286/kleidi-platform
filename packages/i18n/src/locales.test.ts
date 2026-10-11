import { describe, expect, it } from "vitest";
import { resources, SUPPORTED_LOCALES } from "./index.ts";

function keys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

describe("locales", () => {
  it("every locale has exactly the English keys", () => {
    const expected = keys(resources.en.translation).sort();
    for (const locale of SUPPORTED_LOCALES) {
      expect(keys(resources[locale].translation).sort()).toEqual(expected);
    }
  });
});
