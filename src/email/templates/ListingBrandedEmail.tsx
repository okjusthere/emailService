import { Button, Heading, Hr, Img, Link, Section, Text } from "@react-email/components";
import { EmailFrame } from "./components/EmailFrame.js";
import type { ListingEmailSnapshot, RecipientMergeData } from "./types.js";

export function ListingBrandedEmail({
  snapshot,
  recipient,
}: {
  snapshot: ListingEmailSnapshot;
  recipient: RecipientMergeData;
}) {
  const { listing, agent, company, content } = snapshot;
  const description = listing.description ?? listing.shortDescription;
  return (
    <EmailFrame preheader={content.preheader ?? `A new listing from ${company.name}`}>
      <Section style={{ padding: "24px 32px", backgroundColor: "#173c2f" }}>
        <Text
          style={{
            margin: 0,
            color: "#fff",
            fontSize: "20px",
            fontWeight: 700,
            letterSpacing: "0.08em",
          }}
        >
          {company.name}
        </Text>
      </Section>
      <Link href={content.ctaUrl} style={{ display: "block" }}>
        <Img
          src={listing.heroUrl}
          alt={listing.heroAlt}
          width="600"
          style={{ display: "block", width: "100%", height: "auto" }}
        />
      </Link>
      <Section style={{ padding: "32px" }}>
        <Text
          style={{
            margin: "0 0 8px",
            color: "#8a6c38",
            fontSize: "12px",
            fontWeight: 700,
            letterSpacing: "0.14em",
          }}
        >
          NEW LISTING
        </Text>
        <Link href={content.ctaUrl} style={{ color: "#111", textDecoration: "none" }}>
          <Heading as="h1" style={{ margin: "0 0 8px", fontSize: "30px", lineHeight: "36px" }}>
            {listing.title}
          </Heading>
        </Link>
        <Text style={{ margin: "0 0 8px", color: "#55615b", fontSize: "16px" }}>
          {listing.address}, {listing.city}, {listing.stateCode} {listing.postalCode}
        </Text>
        <Text style={{ margin: "0 0 24px", fontSize: "22px", fontWeight: 700 }}>
          {listing.priceText}
        </Text>
        {content.introHtml ? <div dangerouslySetInnerHTML={{ __html: content.introHtml }} /> : null}
        {description ? (
          <Text style={{ fontSize: "16px", lineHeight: "25px" }}>{description}</Text>
        ) : null}
        <Section style={{ margin: "22px 0", padding: "16px", backgroundColor: "#f4f1eb" }}>
          {listing.facts.map((fact) => (
            <Text
              key={fact.label}
              style={{ display: "inline-block", width: "48%", margin: "5px 0", fontSize: "14px" }}
            >
              <strong>{fact.label}:</strong> {fact.value}
            </Text>
          ))}
        </Section>
        {listing.highlights.length ? (
          <ul>
            {listing.highlights.slice(0, 8).map((item) => (
              <li key={item} style={{ marginBottom: "8px" }}>
                {item}
              </li>
            ))}
          </ul>
        ) : null}
        <Button
          href={content.ctaUrl}
          style={{
            display: "block",
            margin: "28px 0",
            padding: "14px 22px",
            backgroundColor: "#173c2f",
            color: "#fff",
            textAlign: "center",
            textDecoration: "none",
            borderRadius: "4px",
            fontWeight: 700,
          }}
        >
          {content.ctaLabel}
        </Button>
        <Hr style={{ borderColor: "#ddd7cc", margin: "28px 0" }} />
        <Text style={{ marginBottom: "4px", fontWeight: 700 }}>{agent.name}</Text>
        {agent.title ? (
          <Text style={{ margin: "0 0 4px", color: "#55615b" }}>{agent.title}</Text>
        ) : null}
        <Text style={{ margin: 0, color: "#55615b" }}>
          {company.name} · <Link href={`mailto:${agent.email}`}>{agent.email}</Link>
          {agent.phone ? ` · ${agent.phone}` : ""}
        </Text>
      </Section>
      <Section
        style={{
          padding: "22px 32px",
          backgroundColor: "#ece8df",
          color: "#657068",
          fontSize: "12px",
          lineHeight: "18px",
        }}
      >
        <Text>
          {company.name} · {company.postalAddress}
        </Text>
        <Text>
          You are receiving this real estate marketing message because of your relationship with
          Homix Realty. <Link href={recipient.unsubscribeUrl}>Unsubscribe</Link>.
        </Text>
      </Section>
    </EmailFrame>
  );
}
