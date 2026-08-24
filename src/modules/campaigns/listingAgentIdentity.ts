import { DomainError } from "../../shared/errors.js";

export type ListingAgentIdentity = {
  id: string;
  displayName: string;
  email: string;
  phone: string | null;
  title: string | null;
  headshotUrl: string | null;
  signatureHtml: string | null;
};

/**
 * Listing campaigns always speak for the listing's assigned agent. The legacy
 * campaign/fixed identities are accepted only to make that trust boundary
 * explicit; neither may override the listing owner.
 */
export function resolveListingAgentIdentity(input: {
  listingAgent: ListingAgentIdentity;
  legacyCampaignAgent?: ListingAgentIdentity | null;
  legacyFixedReplyToEmail?: string | null;
}) {
  const agent = input.listingAgent;
  if (!agent.email.trim())
    throw new DomainError(
      "LISTING_AGENT_EMAIL_REQUIRED",
      "The listing agent must have an email address before this campaign can be sent.",
      409
    );
  return {
    id: agent.id,
    name: agent.displayName,
    email: agent.email,
    phone: agent.phone ?? undefined,
    title: agent.title ?? undefined,
    headshotUrl: agent.headshotUrl ?? undefined,
    signatureHtml: agent.signatureHtml ?? undefined,
  };
}
