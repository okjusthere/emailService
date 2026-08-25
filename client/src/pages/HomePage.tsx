import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, Search } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { campaignsApi } from "../api/campaigns.js";
import { listingsApi } from "../api/listings.js";
import { oneKeyApi, type OneKeySearchResult as SearchResult } from "../api/onekey.js";
import { queryKeys } from "../api/queryKeys.js";
import { CampaignRow } from "../features/campaigns/CampaignRow.js";
import { api } from "../lib/api.js";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/ui/Feedback.js";

function track(
  event: string,
  metadata?: Record<string, string | number | boolean | null>,
  campaignId?: string
) {
  void api("/api/v2/product-events", {
    method: "POST",
    body: JSON.stringify({ event, metadata, campaignId }),
  }).catch(() => undefined);
}

export function HomePage() {
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const search = useQuery({
    queryKey: queryKeys.propertySearch(query),
    queryFn: ({ signal }) => oneKeyApi.search(query, signal),
    enabled: query.length >= 2,
  });
  const recent = useQuery({
    queryKey: ["home-campaigns"],
    queryFn: () => campaignsApi.list("limit=5"),
  });
  const activeListings = useQuery({
    queryKey: ["home-listings"],
    queryFn: () => listingsApi.list("limit=5&status=ACTIVE"),
  });
  const start = useMutation({
    mutationFn: async ({
      result,
      useExisting = false,
    }: {
      result: SearchResult;
      useExisting?: boolean;
    }) => {
      let listingId = result.importedListingId;
      if (!useExisting) {
        const imported = await oneKeyApi.import(result.sourceKey);
        listingId = imported.listing.id;
      }
      if (!listingId) throw new Error("This property could not be prepared for an email.");
      const response = await campaignsApi.quickStart(listingId);
      track("campaign_start", undefined, response.campaign.id);
      return response.campaign;
    },
    onSuccess: (campaign) => {
      track("property_selected", undefined, campaign.id);
      void navigate(`/campaigns/${campaign.id}/edit`);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const next = input.trim();
    if (next.length < 2) return;
    setQuery(next);
    track("property_search", { queryLength: next.length });
  }

  return (
    <main className="home-page">
      <section className="home-hero">
        <span className="home-kicker">Listing email composer</span>
        <h1>Create a listing email</h1>
        <p>Search OneKey by MLS number or property address.</p>
        <form className="property-search" role="search" onSubmit={submit}>
          <Search aria-hidden="true" />
          <label className="sr-only" htmlFor="property-query">
            MLS number or address
          </label>
          <input
            id="property-query"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Enter MLS number or property address"
            autoComplete="off"
          />
          <button className="button primary" disabled={input.trim().length < 2}>
            Find property
          </button>
        </form>
        <p className="search-hint">
          Try a complete MLS number or street address.{" "}
          <a href="/properties?create=1">Create a property manually</a>
        </p>
      </section>

      {query ? (
        <section className="search-results" aria-live="polite">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Search results</span>
              <h2>Choose a property</h2>
            </div>
            <span>{search.data?.items.length ?? 0} found</span>
          </div>
          {search.isLoading ? <LoadingBlock label="Searching OneKey…" /> : null}
          {search.error ? <ErrorBlock error={search.error} /> : null}
          {search.data?.items.length === 0 ? (
            <EmptyBlock title="No OneKey listing found">
              Check the MLS number or address.
            </EmptyBlock>
          ) : null}
          <div className="property-result-grid">
            {search.data?.items.map((item) => {
              return (
                <article className="property-result" key={item.sourceKey}>
                  <div className="property-result-image">
                    {item.imageUrls?.[0] ? <img src={item.imageUrls[0]} alt="" /> : <span>H</span>}
                  </div>
                  <div>
                    <span className="property-source">{item.standardStatus ?? "OneKey MLS"}</span>
                    <h3>{item.unparsedAddress}</h3>
                    <small className="property-result-facts">
                      MLS {item.listingId ?? item.sourceKey}
                      {item.propertyType
                        ? ` · ${item.propertyType.replaceAll("_", " ").toLowerCase()}`
                        : ""}
                      {item.transactionType
                        ? ` · ${item.transactionType.replaceAll("_", " ").toLowerCase()}`
                        : ""}
                    </small>
                    {item.listAgentFullName ? <p>Listing agent: {item.listAgentFullName}</p> : null}
                    <p>
                      {item.city}, {item.stateCode} {item.postalCode}
                    </p>
                    {item.listPrice ? (
                      <strong>
                        {new Intl.NumberFormat("en-US", {
                          style: "currency",
                          currency: "USD",
                          maximumFractionDigits: 0,
                        }).format(Number(item.listPrice))}
                      </strong>
                    ) : null}
                  </div>
                  <p className="property-agent-auto">
                    {item.listAgentFullName
                      ? `Signature and replies automatically use ${item.listAgentFullName}'s current OneKey contact details.`
                      : "Signature and replies automatically use the current OneKey listing Agent."}
                  </p>
                  <button
                    className="button secondary"
                    disabled={start.isPending}
                    onClick={() => start.mutate({ result: item })}
                  >
                    {start.isPending ? "Preparing your listing email…" : "Use this property"}
                    {!start.isPending ? <ArrowRight size={16} /> : null}
                  </button>
                </article>
              );
            })}
          </div>
          {start.error ? <ErrorBlock error={start.error} /> : null}
        </section>
      ) : null}

      <section className="home-recent">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Pick up where you left off</span>
            <h2>Recent emails</h2>
          </div>
        </div>
        {recent.isLoading ? (
          <LoadingBlock />
        ) : recent.data?.items.length ? (
          <div className="campaign-list">
            {recent.data.items.map((campaign) => (
              <CampaignRow key={campaign.id} campaign={campaign} />
            ))}
          </div>
        ) : (
          <EmptyBlock title="No emails yet">
            Search for a property to create your first one.
          </EmptyBlock>
        )}
      </section>

      {activeListings.data?.items.length ? (
        <section className="home-listings">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Ready to market</span>
              <h2>Active listings</h2>
            </div>
          </div>
          <div className="compact-listings">
            {activeListings.data.items.map((listing) => (
              <button
                key={listing.id}
                onClick={() =>
                  start.mutate({
                    useExisting: listing.source !== "ONEKEY" || !listing.sourceKey,
                    result: {
                      sourceKey: listing.sourceKey ?? listing.id,
                      importedListingId: listing.id,
                      unparsedAddress: listing.addressLine1,
                      city: listing.city,
                      stateCode: listing.stateCode,
                      postalCode: listing.postalCode,
                    },
                  })
                }
              >
                <span>{listing.addressLine1}</span>
                <small>
                  {listing.city}, {listing.stateCode}
                </small>
                <ArrowRight size={16} />
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
