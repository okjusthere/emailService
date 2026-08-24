export type User = {
  id: string;
  email: string;
  displayName: string | null;
  role: "ADMIN" | "MARKETER" | "VIEWER";
};

export type ListResponse<T> = { items: T[]; total?: number; page?: number; limit?: number };

export type ListingAsset = {
  id: string;
  publicUrl: string;
  thumbnailUrl?: string | null;
  kind: string;
  altText?: string | null;
};

export type Listing = {
  id: string;
  title: string;
  addressLine1: string;
  city: string;
  stateCode: string;
  postalCode: string;
  askingPrice?: string | null;
  askingRentText?: string | null;
  priceUponRequest: boolean;
  status: string;
  propertyType?: string;
  transactionType?: string;
  source?: string;
  sourceKey?: string | null;
  sourceListingId?: string | null;
  shortDescription?: string | null;
  listingUrl?: string | null;
  assets?: ListingAsset[];
  agent?: { displayName: string; email: string; phone?: string | null };
};

export type Campaign = {
  id: string;
  name: string;
  status: string;
  version: number;
  subject: string;
  preheader?: string | null;
  introHtml?: string | null;
  introText?: string | null;
  ctaLabel: string;
  ctaUrl?: string | null;
  templateKey: string;
  timezone: string;
  audienceFilter: Record<string, unknown>;
  lastSuccessfulTestAt?: string | null;
  lastTestedVersion?: number | null;
  scheduledAt?: string | null;
  eligibleCount?: number;
  targetCount?: number;
  acceptedCount?: number;
  deliveredCount?: number;
  clickedCount?: number;
  bouncedCount?: number;
  complainedCount?: number;
  failedCount?: number;
  updatedAt: string;
  listing?: Listing | null;
  senderProfile?: { id: string; name: string; fromEmail: string; fromName?: string };
  replyToAgent?: { displayName: string; email: string; phone?: string | null } | null;
  savedAudience?: { id: string; name: string; lastEstimatedCount?: number | null } | null;
};

export type AiStatus = {
  enabled: boolean;
  productionReady: boolean;
  mode: "disabled" | "test" | "production";
};
