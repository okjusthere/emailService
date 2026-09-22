import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { stricterSuppression } from "../../src/modules/suppressions/domain.js";
import {
  classifyBounce,
  classifyClick,
  shouldReplaceBounceClassification,
} from "../../src/modules/webhooks/classification.js";

const snapshot = {
  content: { ctaUrl: "https://homixny.com/listings/123?source=email&listing=123" },
  company: { website: "https://homixny.com" },
};

function click(link: unknown, userAgent: unknown = "Mozilla/5.0 Chrome/140.0") {
  return classifyClick({
    payload: { data: { click: { link, userAgent } } },
    contentSnapshot: snapshot,
    baseUrl: "https://mail.homixny.com",
    unsubscribeTokenHash: createHash("sha256").update("signed-token").digest("hex"),
  });
}

describe("provider click classification", () => {
  it("matches the frozen CTA including its query identity, without claiming a human click", () => {
    expect(click("https://homixny.com/listings/123?listing=123&source=email#details")).toEqual({
      linkPurpose: "listing",
      automationClassification: "unknown",
    });
    expect(click("https://homixny.com/listings/123?listing=456&source=email").linkPurpose).toBe(
      "other"
    );
    expect(click("https://homixny.com/listings/another").linkPurpose).toBe("other");
    expect(
      click("https://homixny.com.evil.example/listings/123?source=email&listing=123").linkPurpose
    ).toBe("other");
  });

  it("separates the exact unsubscribe token and company destination from listing interest", () => {
    expect(click("https://mail.homixny.com/unsubscribe?token=signed-token").linkPurpose).toBe(
      "unsubscribe"
    );
    expect(
      click("https://mail.homixny.com/api/public/unsubscribe/one-click?token=signed-token")
        .linkPurpose
    ).toBe("unsubscribe");
    expect(click("https://mail.homixny.com/unsubscribe?token=another-recipient").linkPurpose).toBe(
      "other"
    );
    expect(click("https://homixny.com/").linkPurpose).toBe("company");
  });

  it("excludes explicitly identifiable automation but does not classify Google proxies as human or bot", () => {
    expect(click(snapshot.content.ctaUrl, "Mozilla/5.0 (compatible; Googlebot/2.1)")).toEqual({
      linkPurpose: "listing",
      automationClassification: "automated",
    });
    expect(click(snapshot.content.ctaUrl, "GoogleImageProxy").automationClassification).toBe(
      "unknown"
    );
    expect(click(snapshot.content.ctaUrl, null).automationClassification).toBe("unknown");
  });

  it.each([null, 42, "not a url", "javascript:alert(1)", "https://user:password@homixny.com/"])(
    "does not infer a destination from malformed payload %s",
    (link) => expect(click(link).linkPurpose).toBe("other")
  );
});

describe("provider bounce classification", () => {
  it.each([
    ["Permanent", "Permanent", "HARD_BOUNCE"],
    ["Transient", "Transient", "SOFT_BOUNCE"],
    ["Undetermined", "Undetermined", "BOUNCE_REVIEW"],
    ["future-type", "Undetermined", "BOUNCE_REVIEW"],
    [undefined, "Undetermined", "BOUNCE_REVIEW"],
  ])(
    "keeps %s failures in the appropriate suppression policy",
    (input, type, suppressionReason) => {
      expect(classifyBounce({ data: { bounce: { type: input } } })).toMatchObject({
        type,
        suppressionReason,
      });
    }
  );

  it("returns a safe explanation instead of exposing recipient diagnostics", () => {
    const result = classifyBounce({
      data: {
        bounce: {
          type: "Transient",
          subType: "General",
          message: "451 DNS failure resolving private@example.com at 192.0.2.1; id=private-request",
        },
      },
    });
    expect(result.reason).toBe("The recipient domain could not be resolved.");
    expect(JSON.stringify(result)).not.toContain("private");
    expect(JSON.stringify(result)).not.toContain("192.0.2.1");
    expect(
      classifyBounce({ data: { bounce: { subType: "private@example.com" } } }).subType
    ).toBeNull();
  });

  it.each([
    [
      ["smtp; 451 DNS lookup failed for private@example.com at 192.0.2.1"],
      "The recipient domain could not be resolved.",
    ],
    [
      ["smtp; 550 5.7.1 Delivery refused by organization policy for private@example.com"],
      "The recipient server rejected the message under its delivery policy.",
    ],
    [
      ["smtp; 421 Connection timed out to 192.0.2.1"],
      "Connection to the recipient server failed or timed out.",
    ],
    ["smtp; 552 5.2.2 Recipient storage quota exceeded", "The recipient mailbox is full."],
    [[null, { message: "DNS problem" }, 42], "Temporary delivery failure; review required."],
  ])("uses safe SMTP diagnosticCode summaries for %j", (diagnosticCode, reason) => {
    const result = classifyBounce({
      data: {
        bounce: {
          type: "Transient",
          subType: "General",
          message: "The email delivery failed",
          diagnosticCode,
        },
      },
    });
    expect(result.reason).toBe(reason);
    expect(JSON.stringify(result)).not.toContain("private@example.com");
    expect(JSON.stringify(result)).not.toContain("192.0.2.1");
  });

  it("prefers specific SMTP diagnostics over a generic rejection message", () => {
    expect(
      classifyBounce({
        data: {
          bounce: {
            type: "Transient",
            message: "Message rejected",
            diagnosticCode: ["smtp; 421 Connection timed out"],
          },
        },
      }).reason
    ).toBe("Connection to the recipient server failed or timed out.");
  });

  it("does not downgrade permanent failure or terminal suppression evidence", () => {
    expect(shouldReplaceBounceClassification("Permanent", "Transient")).toBe(false);
    expect(shouldReplaceBounceClassification("Transient", "Permanent")).toBe(true);
    expect(shouldReplaceBounceClassification(null, "Undetermined")).toBe(true);
    for (const existing of [
      "COMPLAINT",
      "UNSUBSCRIBE",
      "MANUAL",
      "HARD_BOUNCE",
      "PROVIDER_SUPPRESSED",
      "INVALID_ADDRESS",
    ] as const) {
      expect(stricterSuppression(existing, "SOFT_BOUNCE")).toBe(existing);
      expect(stricterSuppression(existing, "BOUNCE_REVIEW")).toBe(existing);
    }
    expect(stricterSuppression("SOFT_BOUNCE", "BOUNCE_REVIEW")).toBe("BOUNCE_REVIEW");
    expect(stricterSuppression("BOUNCE_REVIEW", "HARD_BOUNCE")).toBe("HARD_BOUNCE");
  });
});
