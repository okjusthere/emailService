import { Building2, MapPin } from "lucide-react";
import type { Listing } from "../../app/types.js";

function price(listing: Listing) {
  if (listing.askingPrice)
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(Number(listing.askingPrice));
  return (
    listing.askingRentText ?? (listing.priceUponRequest ? "Price on request" : "Contact agent")
  );
}

export function PropertyCard({
  listing,
  compact = false,
}: {
  listing: Listing;
  compact?: boolean;
}) {
  const hero = listing.assets?.find((asset) => asset.kind === "HERO") ?? listing.assets?.[0];
  return (
    <article className={compact ? "property-card compact" : "property-card"}>
      <div className="property-image">
        {hero ? (
          <img src={hero.thumbnailUrl ?? hero.publicUrl} alt={hero.altText ?? listing.title} />
        ) : (
          <Building2 aria-label="No property image" />
        )}
      </div>
      <div className="property-copy">
        <span className="property-source">
          {listing.source === "ONEKEY"
            ? `MLS ${listing.sourceListingId ?? "listing"}`
            : "Homix listing"}
        </span>
        <h2>{listing.title}</h2>
        <p>
          <MapPin size={15} /> {listing.addressLine1}, {listing.city}, {listing.stateCode}{" "}
          {listing.postalCode}
        </p>
        <strong>{price(listing)}</strong>
        <div className="property-meta">
          <span>{listing.status.toLowerCase()}</span>
          {listing.propertyType ? (
            <span>{listing.propertyType.replaceAll("_", " ").toLowerCase()}</span>
          ) : null}
          {listing.transactionType ? (
            <span>{listing.transactionType.replaceAll("_", " ").toLowerCase()}</span>
          ) : null}
          {listing.agent?.displayName ? <span>{listing.agent.displayName}</span> : null}
        </div>
      </div>
    </article>
  );
}
