import { render } from "@react-email/render";
import { BrokerPersonalEmail } from "./templates/BrokerPersonalEmail.js";
import { ListingBrandedEmail } from "./templates/ListingBrandedEmail.js";
import type { ListingEmailSnapshot, RecipientMergeData } from "./templates/types.js";
import { sanitizeIntro, validateRenderedEmail } from "./compliance.js";

const mergeFields: Record<
  string,
  (snapshot: ListingEmailSnapshot, recipient: RecipientMergeData) => string
> = {
  first_name: (_snapshot, recipient) => recipient.firstName ?? "there",
  full_name: (_snapshot, recipient) => recipient.fullName ?? recipient.firstName ?? "there",
  company: (_snapshot, recipient) => recipient.company ?? "",
  agent_name: (snapshot) => snapshot.agent.name,
  listing_title: (snapshot) => snapshot.listing.title,
  listing_city: (snapshot) => snapshot.listing.city,
};

export function applyMergeFields(
  value: string,
  snapshot: ListingEmailSnapshot,
  recipient: RecipientMergeData
): string {
  return value.replace(
    /\{\{([a-z_]+)\}\}/g,
    (_match, key: string) => mergeFields[key]?.(snapshot, recipient) ?? ""
  );
}

export async function renderListingEmail(input: {
  snapshot: ListingEmailSnapshot;
  recipient: RecipientMergeData;
  templateKey: "LISTING_BRANDED" | "BROKER_PERSONAL";
  live?: boolean;
}) {
  const snapshot = structuredClone(input.snapshot);
  snapshot.content.introHtml = sanitizeIntro(
    applyMergeFields(snapshot.content.introHtml ?? "", snapshot, input.recipient)
  );
  snapshot.content.subject = applyMergeFields(snapshot.content.subject, snapshot, input.recipient);
  const element =
    input.templateKey === "BROKER_PERSONAL" ? (
      <BrokerPersonalEmail snapshot={snapshot} recipient={input.recipient} />
    ) : (
      <ListingBrandedEmail snapshot={snapshot} recipient={input.recipient} />
    );
  const html = await render(element);
  const text = await render(element, { plainText: true });
  validateRenderedEmail({
    subject: snapshot.content.subject,
    html,
    text,
    companyAddress: snapshot.company.postalAddress,
    live: input.live ?? false,
  });
  return { html, text, subject: snapshot.content.subject };
}

export type { ListingEmailSnapshot, RecipientMergeData } from "./templates/types.js";
