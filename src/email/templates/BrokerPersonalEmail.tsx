import { Button, Hr, Img, Link, Section, Text } from "@react-email/components";
import { EmailFrame } from "./components/EmailFrame.js";
import type { ListingEmailSnapshot, RecipientMergeData } from "./types.js";

export function BrokerPersonalEmail({
  snapshot,
  recipient,
}: {
  snapshot: ListingEmailSnapshot;
  recipient: RecipientMergeData;
}) {
  const { listing, agent, company, content } = snapshot;
  const greeting = recipient.firstName?.trim() ? `Hi ${recipient.firstName.trim()},` : "Hi there,";
  return (
    <EmailFrame preheader={content.preheader ?? `${agent.name} shared a property with you`}>
      <Section style={{ padding: "32px 38px" }}>
        <Text style={{ margin: "0 0 24px", fontWeight: 700 }}>
          {agent.name} · {company.name}
        </Text>
        <Text style={{ fontSize: "17px" }}>{greeting}</Text>
        {content.introHtml ? (
          <div dangerouslySetInnerHTML={{ __html: content.introHtml }} />
        ) : (
          <Text>I wanted to share a property that may be relevant to you.</Text>
        )}
        <Img
          src={listing.heroUrl}
          alt={listing.heroAlt}
          width="524"
          style={{
            display: "block",
            width: "100%",
            height: "auto",
            margin: "24px 0 18px",
            borderRadius: "5px",
          }}
        />
        <Text style={{ margin: "0 0 4px", fontSize: "22px", fontWeight: 700 }}>
          {listing.title}
        </Text>
        <Text style={{ margin: "0 0 4px", color: "#5b625e" }}>
          {listing.address}, {listing.city}, {listing.stateCode} {listing.postalCode}
        </Text>
        <Text style={{ margin: "0 0 16px", fontWeight: 700 }}>{listing.priceText}</Text>
        {listing.facts.map((fact) => (
          <Text key={fact.label} style={{ margin: "4px 0", fontSize: "14px" }}>
            <strong>{fact.label}:</strong> {fact.value}
          </Text>
        ))}
        {listing.highlights.length ? (
          <ul>
            {listing.highlights.slice(0, 8).map((item) => (
              <li key={item} style={{ marginBottom: "7px" }}>
                {item}
              </li>
            ))}
          </ul>
        ) : null}
        <Button
          href={content.ctaUrl}
          style={{
            display: "inline-block",
            margin: "20px 0",
            padding: "12px 18px",
            backgroundColor: "#173c2f",
            color: "white",
            textDecoration: "none",
            borderRadius: "4px",
          }}
        >
          {content.ctaLabel}
        </Button>
        <Text>
          Best,
          <br />
          {agent.name}
          <br />
          <Link href={`mailto:${agent.email}`}>{agent.email}</Link>
          {agent.phone ? (
            <>
              <br />
              {agent.phone}
            </>
          ) : null}
        </Text>
        <Hr style={{ borderColor: "#ddd7cc", margin: "28px 0" }} />
        <Text style={{ color: "#6c746f", fontSize: "12px", lineHeight: "18px" }}>
          {company.name} · {company.postalAddress}
          <br />
          Real estate marketing communication.{" "}
          <Link href={recipient.unsubscribeUrl}>Unsubscribe</Link>.
        </Text>
      </Section>
    </EmailFrame>
  );
}
