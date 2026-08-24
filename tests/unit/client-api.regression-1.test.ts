import { describe, expect, it } from "vitest";
import { formatEt } from "../../client/src/lib/api.js";

describe("client date formatting", () => {
  // Regression: ISSUE-003 — listing and campaign detail pages crashed while formatting dates
  // Found by /qa on 2026-08-24
  // Report: .gstack/qa-reports/qa-report-marketing-homixny-com-2026-08-24.md
  it("formats an Eastern timestamp without combining incompatible Intl options", () => {
    expect(formatEt("2026-08-24T15:59:36.343Z")).toMatch(/^Aug 24, 2026, 11:59 AM (EDT|GMT-4)$/);
    expect(formatEt(null)).toBe("—");
  });
});
