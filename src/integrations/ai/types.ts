export type AiTone = "professional" | "warm" | "concise" | "luxury";

export interface ListingCopyProposal {
  title: string;
  shortDescription: string;
  longDescription: string;
  highlights: string[];
}

export interface CampaignCopyProposal {
  variants: Array<{
    subject: string;
    preheader: string;
    introText: string;
    ctaLabel: string;
  }>;
  recommendedIndex: number;
}

export interface AiCopyProvider {
  readonly name: string;
  readonly model: string;
  generateListing(input: {
    tone: AiTone;
    facts: Record<string, unknown>;
  }): Promise<ListingCopyProposal>;
  generateCampaign(input: {
    tone: AiTone;
    facts: Record<string, unknown>;
    current: Record<string, unknown>;
  }): Promise<CampaignCopyProposal>;
}
