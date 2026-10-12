import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  defaultExpiry,
  itemState,
  MAX_UPLOAD_BYTES,
  needsAttention,
  sortChecklist,
  uploadProblem,
  type ItemState,
  type ReviewStatus,
  type ScanStatus,
} from "./domain.ts";

const today = new Date("2026-10-11T09:00:00Z");

describe("document rules", () => {
  it("accepts PDFs, images and Word files up to 25 MB", () => {
    const check = (fileName: string, mimeType: string, byteSize: number) =>
      uploadProblem({ fileName, mimeType, byteSize })?.key ?? null;
    expect(check("deed.pdf", "application/pdf", 1000)).toBeNull();
    expect(check("a.exe", "application/x-msdownload", 10)).toBe("fileType");
    expect(check("big.pdf", "application/pdf", MAX_UPLOAD_BYTES + 1)).toBe("fileTooBig");
    expect(check("empty.pdf", "application/pdf", 0)).toBe("fileEmpty");
  });

  it("dates stale searches from the upload day", () => {
    expect(defaultExpiry(30, today)).toBe("2026-11-10");
    expect(defaultExpiry(null, today)).toBeNull();
  });

  it("derives a checklist state from the scan and the expiry date", () => {
    expect(itemState(null, null, today)).toBe("missing");
    const v = (scanStatus: ScanStatus, review: ReviewStatus = "accepted") => ({
      scanStatus,
      review,
    });
    expect(itemState(v("uploading"), null, today)).toBe("missing");
    expect(itemState(v("pending"), null, today)).toBe("scanning");
    expect(itemState(v("infected"), null, today)).toBe("infected");
    expect(itemState(v("clean", "pending"), null, today)).toBe("review");
    expect(itemState(v("clean", "rejected"), null, today)).toBe("rejected");
    expect(itemState(v("clean"), null, today)).toBe("ready");
    expect(itemState(v("clean"), "2026-10-20", today)).toBe("expiring");
    expect(itemState(v("clean"), "2026-10-10", today)).toBe("expired");
  });

  it("puts every item needing attention above every item that does not", () => {
    const states: ItemState[] = [
      "missing",
      "scanning",
      "review",
      "rejected",
      "ready",
      "infected",
      "failed",
      "expiring",
      "expired",
    ];
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...states)), (picked) => {
        const sorted = sortChecklist(picked.map((state, sortOrder) => ({ state, sortOrder })));
        const firstCalm = sorted.findIndex((i) => !needsAttention(i.state));
        return firstCalm < 0 || sorted.slice(firstCalm).every((i) => !needsAttention(i.state));
      }),
    );
  });
});
