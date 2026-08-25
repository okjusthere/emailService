import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RecipientPanel } from "../../client/src/features/composer/RecipientPanel.js";
import { MessagePanel } from "../../client/src/features/composer/MessagePanel.js";
import { PropertyCard } from "../../client/src/features/properties/PropertyCard.js";
import { StatusBadge } from "../../client/src/components/ui/StatusBadge.js";

describe("simplified listing-email UI", () => {
  it("presents property and recipient choices in marketer language", () => {
    const property = renderToStaticMarkup(
      <PropertyCard
        compact
        listing={{
          id: "listing",
          title: "136-20 Roosevelt Avenue",
          addressLine1: "136-20 Roosevelt Avenue",
          city: "Flushing",
          stateCode: "NY",
          postalCode: "11354",
          askingPrice: "1200000",
          priceUponRequest: false,
          status: "ACTIVE",
          source: "ONEKEY",
        }}
      />
    );
    const recipients = renderToStaticMarkup(
      <RecipientPanel
        summary={null}
        pending={false}
        automatic
        disabled={false}
        error={null}
        onGenerate={vi.fn()}
        savedAudiences={[]}
        onSelectAudience={vi.fn()}
      />
    );
    expect(property).toContain("136-20 Roosevelt Avenue");
    expect(recipients).toContain("Preparing recipients");
    expect(recipients).not.toContain("Suggest recipients");
    expect(recipients).toContain("Same ZIP plus 3 nearby ZIP codes");
    expect(recipients).toContain("Saved contact list");
    expect(recipients).toContain("Custom segment");
    expect(recipients).not.toContain("audienceFilter");
  });

  it("keeps content editable while describing AI and lifecycle status plainly", () => {
    const message = renderToStaticMarkup(
      <MessagePanel
        draft={{
          subject: "A new Flushing listing",
          preheader: "Take a look",
          introHtml: "<p>Hello</p>",
          introText: "Hello",
          ctaLabel: "View Listing",
          ctaUrl: "https://www.homixny.com/listings",
          templateKey: "LISTING_BRANDED",
        }}
        aiState="done"
        aiReady
        aiPending={false}
        actionsDisabled={false}
        onChange={vi.fn()}
        onRewrite={vi.fn()}
        variants={[]}
        onVariant={vi.fn()}
      />
    );
    expect(message).toContain("AI draft — review before sending");
    expect(message).toContain("Rewrite");
    expect(renderToStaticMarkup(<StatusBadge value="SNAPSHOTTING" />)).toContain("Preparing");
  });

  it("blocks recipient and AI actions while an edit is still saving", () => {
    const recipients = renderToStaticMarkup(
      <RecipientPanel
        summary={null}
        pending={false}
        automatic={false}
        disabled
        error={null}
        onGenerate={vi.fn()}
        savedAudiences={[]}
        onSelectAudience={vi.fn()}
      />
    );
    const message = renderToStaticMarkup(
      <MessagePanel
        draft={{
          subject: "Draft",
          preheader: "",
          introHtml: "<p>Hello</p>",
          introText: "Hello",
          ctaLabel: "View Listing",
          ctaUrl: "https://www.homixny.com/listings",
          templateKey: "LISTING_BRANDED",
        }}
        aiState="done"
        aiReady
        aiPending={false}
        actionsDisabled
        onChange={vi.fn()}
        onRewrite={vi.fn()}
        variants={[{ subject: "AI option" }]}
        onVariant={vi.fn()}
      />
    );

    expect(recipients).toContain("disabled");
    expect(message.match(/disabled/g)).toHaveLength(3);
  });
});
