export interface ListingEmailSnapshot {
  listing: {
    id: string;
    title: string;
    address: string;
    city: string;
    stateCode: string;
    postalCode: string;
    priceText: string;
    description?: string;
    /** @deprecated Retained so archived V1 snapshots remain renderable. */
    shortDescription?: string;
    highlights: string[];
    facts: Array<{ label: string; value: string }>;
    heroUrl: string;
    heroAlt: string;
  };
  agent: {
    name: string;
    email: string;
    phone?: string;
    title?: string;
    headshotUrl?: string;
    signatureHtml?: string;
  };
  sender: { fromName: string; fromEmail: string; replyTo: string };
  company: { name: string; postalAddress: string; website: string };
  content: {
    subject: string;
    preheader?: string;
    introHtml?: string;
    introText?: string;
    ctaLabel: string;
    ctaUrl: string;
  };
  templateVersion: string;
}

export interface RecipientMergeData {
  firstName?: string;
  fullName?: string;
  company?: string;
  unsubscribeUrl: string;
}
