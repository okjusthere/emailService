import { describe, expect, it } from "vitest";
import { renderListingEmail, type ListingEmailSnapshot } from "../../src/email/render.js";

const snapshot: ListingEmailSnapshot = {
  listing: {
    id: "listing-1",
    title: "42 Harbor Avenue",
    address: "42 Harbor Avenue",
    city: "Huntington",
    stateCode: "NY",
    postalCode: "11743",
    priceText: "$2,450,000",
    shortDescription: "A waterfront investment opportunity.",
    highlights: ["8,500 SF", "Waterfront access"],
    facts: [{ label: "Building", value: "8,500 SF" }],
    heroUrl: "https://assets.example.com/listing.jpg",
    heroAlt: "Waterfront building",
  },
  agent: {
    name: "Alex Morgan",
    email: "alex@example.com",
    phone: "631-555-0100",
    title: "Licensed Associate Broker",
  },
  sender: {
    fromName: "Homix Listings",
    fromEmail: "listings@example.com",
    replyTo: "alex@example.com",
  },
  company: {
    name: "Homix Realty",
    postalAddress: "123 Main Street, Huntington, NY 11743",
    website: "https://homixny.com",
  },
  content: {
    subject: "{{first_name}}, see {{listing_title}}",
    preheader: "A new Long Island opportunity",
    introHtml:
      '<p>Hello {{first_name}}.</p><img src=x onerror="alert(1)"><script>alert(2)</script>',
    ctaLabel: "View listing",
    ctaUrl: "https://homixny.com/listings/42-harbor",
  },
  templateVersion: "listing-branded@1",
};

describe.each(["LISTING_BRANDED", "BROKER_PERSONAL"] as const)("%s template", (templateKey) => {
  it("renders compliant HTML and plain text with frozen content", async () => {
    const result = await renderListingEmail({
      snapshot,
      recipient: {
        firstName: "María",
        fullName: "María Chen",
        company: "North Shore Capital",
        unsubscribeUrl:
          "https://marketing.homixny.com/api/public/unsubscribe/one-click?token=signed",
      },
      templateKey,
    });
    expect(result.subject).toContain("María");
    expect(result.html).toContain("42 Harbor Avenue");
    expect(result.html).toContain("A new Long Island opportunity");
    expect(result.html).toContain("123 Main Street");
    expect(result.html).toContain("unsubscribe");
    expect(result.html).not.toMatch(/script|onerror/i);
    expect(result.text).toContain("42 Harbor Avenue");
    expect(result.text).toContain("$2,450,000");
  });
});
