import { describe, expect, it } from "vitest";
import { resolveListingAgentIdentity } from "../../src/modules/campaigns/listingAgentIdentity.js";

describe("listing campaign agent identity regression", () => {
  it("ignores legacy campaign and sender fallback identities", () => {
    const identity = resolveListingAgentIdentity({
      listingAgent: {
        id: "listing-agent",
        displayName: "Listing Agent",
        email: "listing.agent@example.com",
        phone: "718-555-0101",
        title: "Licensed Real Estate Salesperson",
        headshotUrl: null,
        signatureHtml: null,
      },
      legacyCampaignAgent: {
        id: "global-agent",
        displayName: "Eric Wei",
        email: "eric.wei@homixny.com",
        phone: null,
        title: null,
        headshotUrl: null,
        signatureHtml: null,
      },
      legacyFixedReplyToEmail: "fallback@homixny.com",
    });

    expect(identity).toMatchObject({
      id: "listing-agent",
      name: "Listing Agent",
      email: "listing.agent@example.com",
    });
  });
});
