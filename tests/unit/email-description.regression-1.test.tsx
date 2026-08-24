import { describe, expect, it } from "vitest";
import { renderListingEmail, type ListingEmailSnapshot } from "../../src/email/render.js";
import { summarizePublicRemarks } from "../../src/modules/onekey/remarks.js";

const fullEnding = "This final sentence must remain visible in the delivered email.";
const description = `${"Verified listing detail. ".repeat(60)}${fullEnding}`;

const snapshot: ListingEmailSnapshot = {
  listing: {
    id: "listing-regression",
    title: "91-14 86th Drive",
    address: "91-14 86th Drive",
    city: "Woodhaven",
    stateCode: "NY",
    postalCode: "11421",
    priceText: "$899,000",
    description,
    shortDescription: "Legacy truncated text that must not win.",
    highlights: [],
    facts: [],
    heroUrl: "https://assets.example.com/listing.jpg",
    heroAlt: "Listing exterior",
  },
  agent: { name: "Listing Agent", email: "listing.agent@example.com" },
  sender: {
    fromName: "Homix Listings",
    fromEmail: "listings@updates.homixny.com",
    replyTo: "listing.agent@example.com",
  },
  company: {
    name: "Homix Realty",
    postalAddress: "3720 Prince St, STE 3H, Flushing, NY 11354",
    website: "https://homixny.com",
  },
  content: {
    subject: "Complete listing",
    ctaLabel: "View Listing",
    ctaUrl: "https://homixny.com/listings/example",
  },
  templateVersion: "listing-branded@2",
};

describe("complete listing description regression", () => {
  it.each(["LISTING_BRANDED", "BROKER_PERSONAL"] as const)(
    "renders the complete description in %s",
    async (templateKey) => {
      const result = await renderListingEmail({
        snapshot,
        recipient: { unsubscribeUrl: "https://marketing.homixny.com/unsubscribe?token=test" },
        templateKey,
      });
      expect(result.html).toContain(fullEnding);
      expect(result.text).toContain(fullEnding);
      expect(result.html).not.toContain("Legacy truncated text that must not win.");
    }
  );

  it("summarizes imported remarks without cutting a word in half", () => {
    const summary = summarizePublicRemarks(`${"Complete words ".repeat(100)}ending`, 80);
    expect(summary!.length).toBeLessThanOrEqual(80);
    expect(summary).toMatch(/words…$/);
    expect(summary).not.toMatch(/word…$/);
  });
});
