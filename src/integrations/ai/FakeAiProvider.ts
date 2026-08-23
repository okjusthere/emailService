import type { AiCopyProvider, AiTone, CampaignCopyProposal, ListingCopyProposal } from "./types.js";

function text(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numericText(value: unknown) {
  return typeof value === "number" || typeof value === "string" ? String(value) : null;
}

export class FakeAiProvider implements AiCopyProvider {
  readonly name = "fake";
  readonly model = "fake-deterministic-v1";

  async generateListing(input: {
    tone: AiTone;
    facts: Record<string, unknown>;
  }): Promise<ListingCopyProposal> {
    const address = text(input.facts.address, "New York property");
    const property = text(input.facts.propertySubType, text(input.facts.propertyType, "property"));
    return {
      title: `${address} · ${property}`.slice(0, 200),
      shortDescription:
        `A ${input.tone} introduction to this ${property.toLowerCase()} opportunity.`.slice(
          0,
          1000
        ),
      longDescription: `Discover ${address}. Review the verified property facts, imagery, and availability with the Homix team.`,
      highlights: [
        numericText(input.facts.bedroomsTotal)
          ? `${numericText(input.facts.bedroomsTotal)} bedrooms`
          : "Convenient location",
        numericText(input.facts.bathroomsTotalInteger)
          ? `${numericText(input.facts.bathroomsTotalInteger)} bathrooms`
          : "Flexible living space",
        numericText(input.facts.livingArea)
          ? `${numericText(input.facts.livingArea)} square feet`
          : "Contact us for details",
      ],
    };
  }

  async generateCampaign(input: {
    tone: AiTone;
    facts: Record<string, unknown>;
    current: Record<string, unknown>;
  }): Promise<CampaignCopyProposal> {
    const address = text(input.facts.address, "a new Homix listing");
    return {
      variants: [
        {
          subject: `Just listed: ${address}`.slice(0, 150),
          preheader: "Verified property facts and photos from Homix Realty.",
          introText: `I wanted to share ${address} with you. Take a look at the verified details below.`,
          ctaLabel: "View Listing",
        },
        {
          subject: `A new opportunity in ${text(input.facts.city, "New York")}`.slice(0, 150),
          preheader: "Explore this new listing and connect with our team.",
          introText: `This ${input.tone} listing announcement highlights the key facts without changing the MLS source record.`,
          ctaLabel: "Explore Property",
        },
        {
          subject: `Property spotlight · ${address}`.slice(0, 150),
          preheader: "See the latest listing from Homix Realty.",
          introText:
            "Please review this property spotlight and reach out if it fits your clients' needs.",
          ctaLabel: "See Details",
        },
      ],
      recommendedIndex: 0,
    };
  }
}
