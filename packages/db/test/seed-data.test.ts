import { describe, expect, it } from "vitest";
import { JURISDICTIONS } from "../src/seed-data/index.ts";

// Pure checks on the reference data, so a typo in a template fails before it reaches a database.
describe("jurisdiction seed data", () => {
  it("covers Cyprus and England and Wales", () => {
    expect(JURISDICTIONS.map((j) => j.code)).toEqual(["CY", "EW"]);
  });

  it("gives each jurisdiction its own time zone and phone example", () => {
    const byCode = Object.fromEntries(JURISDICTIONS.map((j) => [j.code, j]));
    expect(byCode.CY).toMatchObject({ timezone: "Asia/Nicosia", defaultLocale: "el" });
    expect(byCode.EW).toMatchObject({
      name: "England and Wales",
      timezone: "Europe/London",
      defaultLocale: "en",
      asksTenure: true,
    });
    expect(byCode.EW!.phoneExample).toMatch(/^\+44 /);
    expect(byCode.CY!.asksTenure).toBe(false);
    expect(byCode.CY!.currency).toBe("EUR");
    expect(byCode.EW!.currency).toBe("GBP");
  });

  for (const j of JURISDICTIONS) {
    describe(j.code, () => {
      it("uses two-letter codes, which the template route expects", () => {
        expect(j.code).toMatch(/^[A-Z]{2}$/);
      });

      it("has unique stage keys and ends on the completed stage", () => {
        const keys = j.stages.map((s) => s.key);
        expect(new Set(keys).size).toBe(keys.length);
        expect(keys.at(-1)).toBe("completed");
      });

      it("hangs every requirement on a real working stage, with unique keys", () => {
        const stages = new Set(j.stages.map((s) => s.key));
        const keys = j.requirements.map((r) => r.key);
        expect(new Set(keys).size).toBe(keys.length);
        for (const r of j.requirements) {
          expect(stages.has(r.stageKey), `${r.key} -> ${r.stageKey}`).toBe(true);
          expect(r.stageKey).not.toBe("completed");
        }
      });

      it("gives clients guidance for every stage in English, Greek and Russian", () => {
        for (const s of j.stages) {
          for (const lang of ["en", "el", "ru"] as const) {
            expect(s.clientNow?.[lang]?.trim(), `${s.key} now ${lang}`).toBeTruthy();
            expect(s.clientAction?.[lang]?.trim(), `${s.key} action ${lang}`).toBeTruthy();
          }
          // A translation that is just the English copied across would pass the check above.
          expect(s.clientNow!.el).not.toBe(s.clientNow!.en);
          expect(s.clientNow!.ru).not.toBe(s.clientNow!.en);
        }
      });

      it("has English text for every label and help line", () => {
        for (const s of j.stages) expect(s.label.en.trim()).not.toBe("");
        for (const r of j.requirements) {
          expect(r.label.en.trim(), r.key).not.toBe("");
          expect(r.help.en.trim(), r.key).not.toBe("");
        }
      });
    });
  }

  it("lists the core England and Wales conveyancing documents", () => {
    const ew = JURISDICTIONS.find((j) => j.code === "EW")!;
    expect(ew.stages.map((s) => s.key)).toEqual([
      "instruction",
      "pre_contract",
      "enquiries",
      "mortgage",
      "exchange",
      "completion",
      "post_completion",
      "completed",
    ]);
    expect(ew.requirements.map((r) => r.key)).toEqual(
      expect.arrayContaining([
        "id_verification",
        "source_of_funds",
        "title_register",
        "local_search",
        "property_information_form",
        "report_on_title",
        "mortgage_offer",
        "transaction_tax_return",
        "land_registry_application",
      ]),
    );
    // Searches go stale, so they carry an expiry.
    expect(ew.requirements.find((r) => r.key === "local_search")!.expiryDays).toBeGreaterThan(0);
  });
});
