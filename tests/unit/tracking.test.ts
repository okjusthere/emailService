import { afterEach, describe, expect, it, vi } from "vitest";
import { ResendEmailProvider } from "../../src/email/providers/ResendEmailProvider.js";
import {
  parseTrackingSnapshot,
  trackingSnapshotFromObservation,
  type TrackingObservation,
} from "../../src/modules/tracking/domain.js";

const now = new Date("2026-09-22T15:00:00Z");
const observed: TrackingObservation = {
  id: "domain-observation",
  revision: 2,
  provider: "resend",
  domain: "updates.example.com",
  providerDomainId: "domain-id",
  openTrackingEnabled: false,
  clickTrackingEnabled: true,
  trackingDomain: "links.updates.example.com",
  trackingVerified: true,
  checkedAt: now,
  lastError: null,
};
afterEach(() => vi.unstubAllGlobals());

describe("verified tracking coverage", () => {
  it("does not treat an enabled toggle without verified DNS as measurable coverage", () => {
    expect(
      trackingSnapshotFromObservation({ ...observed, trackingVerified: false }, now)
    ).toMatchObject({ openTrackingEnabled: false, clickTrackingEnabled: null });
  });
  it("preserves real disabled and enabled states only for fresh successful observations", () => {
    expect(trackingSnapshotFromObservation(observed, now)).toMatchObject({
      openTrackingEnabled: false,
      clickTrackingEnabled: true,
      revision: "domain-observation:2",
    });
    for (const record of [
      { ...observed, checkedAt: new Date(now.getTime() - 300_000) },
      { ...observed, checkedAt: new Date(now.getTime() + 1000) },
      { ...observed, lastError: "API unavailable" },
      { ...observed, checkedAt: null },
    ])
      expect(trackingSnapshotFromObservation(record, now)).toMatchObject({
        openTrackingEnabled: null,
        clickTrackingEnabled: null,
      });
  });
  it("reads an old batch snapshot without replacing it with current settings", () => {
    const snapshot = trackingSnapshotFromObservation(observed, now);
    expect(parseTrackingSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
    expect(parseTrackingSnapshot(null)).toBeNull();
    expect(parseTrackingSnapshot({ ...snapshot, clickTrackingEnabled: "true" })).toBeNull();
  });
});

describe("Resend domain configuration reads", () => {
  it("paginates domains and checks the active tracking CNAME rather than only sending verification", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ data: [{ id: "other", name: "other.example.com" }], has_more: true })
      )
      .mockResolvedValueOnce(
        Response.json({
          data: [{ id: "our-domain", name: "updates.example.com" }],
          has_more: false,
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          id: "our-domain",
          name: "updates.example.com",
          status: "verified",
          open_tracking: false,
          click_tracking: true,
          tracking_subdomain: "links",
          records: [
            { record: "Tracking", name: "old.updates.example.com", status: "verified" },
            { record: "Tracking", name: "links.updates.example.com", status: "pending" },
          ],
        })
      );
    vi.stubGlobal("fetch", fetch);
    const result = await new ResendEmailProvider("re_test", "whsec_test").getDomainTracking(
      "updates.example.com"
    );
    expect(result).toMatchObject({
      providerDomainId: "our-domain",
      clickTrackingEnabled: true,
      trackingVerified: false,
    });
    expect(fetch.mock.calls[1]![0]).toContain("after=other");
    expect(fetch.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
  });
  it("rejects a different domain rather than inheriting another sender's tracking settings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          id: "wrong",
          name: "invoice.example.com",
          open_tracking: true,
          click_tracking: true,
          records: [],
        })
      )
    );
    await expect(
      new ResendEmailProvider("re_test", "whsec_test").getDomainTracking(
        "updates.example.com",
        "wrong"
      )
    ).rejects.toThrow("does not match");
  });
  it("retains unknown booleans when the provider omits capabilities", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          id: "ours",
          name: "updates.example.com",
          records: [],
        })
      )
    );
    expect(
      await new ResendEmailProvider("re_test", "whsec_test").getDomainTracking(
        "updates.example.com",
        "ours"
      )
    ).toMatchObject({
      openTrackingEnabled: null,
      clickTrackingEnabled: null,
      trackingVerified: false,
    });
  });
});
