import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Plus, Search } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { Campaign, ListResponse, Listing } from "../app/types.js";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/ui/Feedback.js";
import { Page } from "../components/ui/Page.js";
import { api } from "../lib/api.js";

type Agent = { id: string; displayName: string; isActive: boolean };

function slug(value: string) {
  return `${value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")}-${Date.now()}`;
}

export function PropertyLibraryPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const creating = params.get("create") === "1";
  const listings = useQuery({
    queryKey: ["property-library", search],
    queryFn: () =>
      api<ListResponse<Listing>>(`/api/v2/listings?limit=100&search=${encodeURIComponent(search)}`),
  });
  const agents = useQuery({
    queryKey: ["agents-for-properties"],
    queryFn: () => api<ListResponse<Agent>>("/api/v2/agents?limit=100"),
  });
  const activeAgent = useMemo(
    () => agents.data?.items.find((item) => item.isActive),
    [agents.data]
  );
  const start = useMutation({
    mutationFn: (listingId: string) =>
      api<{ campaign: Campaign }>("/api/v2/campaigns/quick-start", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ listingId }),
      }),
    onSuccess: ({ campaign }) => void navigate(`/campaigns/${campaign.id}/edit`),
  });
  const create = useMutation({
    mutationFn: async (form: HTMLFormElement) => {
      if (!activeAgent) throw new Error("Add an active listing agent in Settings first.");
      const values = new FormData(form);
      const addressLine1 = String(values.get("addressLine1"));
      const heroPhoto = values.get("heroPhoto");
      if (!(heroPhoto instanceof File) || !heroPhoto.size)
        throw new Error("Choose a property photo before creating the email.");
      const listing = await api<Listing>("/api/v2/listings", {
        method: "POST",
        body: JSON.stringify({
          internalName: addressLine1,
          title: addressLine1,
          slug: slug(addressLine1),
          status: "DRAFT",
          transactionType: values.get("transactionType"),
          propertyType: values.get("propertyType"),
          addressLine1,
          city: values.get("city"),
          stateCode: values.get("stateCode"),
          postalCode: values.get("postalCode"),
          askingPrice:
            values.get("transactionType") === "FOR_SALE" ? values.get("askingPrice") : null,
          askingRentText:
            values.get("transactionType") === "FOR_LEASE" ? values.get("askingRentText") : null,
          priceUponRequest: false,
          highlights: [],
          listingUrl: "https://www.homixny.com/listings",
          agentId: activeAgent.id,
        }),
      });
      const asset = new FormData();
      asset.set("file", heroPhoto);
      asset.set("kind", "HERO");
      asset.set("altText", addressLine1);
      await api(`/api/v2/listings/${listing.id}/assets`, { method: "POST", body: asset });
      return api<Listing>(`/api/v2/listings/${listing.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "ACTIVE" }),
      });
    },
    onSuccess: (listing) => {
      setParams({});
      void client.invalidateQueries({ queryKey: ["property-library"] });
      start.mutate(listing.id);
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    create.mutate(event.currentTarget);
  }
  return (
    <Page
      title="Property Library"
      description="Imported and manual properties. Daily email work can still begin directly from Home."
      action={
        <button className="button primary" onClick={() => setParams({ create: "1" })}>
          <Plus size={16} /> Create property
        </button>
      }
    >
      {creating ? (
        <form className="panel-simple property-create-form" onSubmit={submit}>
          <div className="section-heading">
            <div>
              <h2>Create a property manually</h2>
              <p>Add the essentials and a hero photo, then start the email.</p>
            </div>
          </div>
          <label>
            Street address
            <input name="addressLine1" required />
          </label>
          <label>
            City
            <input name="city" required />
          </label>
          <label>
            State
            <input name="stateCode" defaultValue="NY" maxLength={2} required />
          </label>
          <label>
            ZIP code
            <input name="postalCode" inputMode="numeric" required />
          </label>
          <label>
            Property type
            <select name="propertyType" defaultValue="OTHER">
              <option value="RESIDENTIAL">Residential</option>
              <option value="MULTIFAMILY">Multi family</option>
              <option value="OFFICE">Office</option>
              <option value="RETAIL">Retail</option>
              <option value="INDUSTRIAL">Industrial</option>
              <option value="LAND">Land</option>
              <option value="OTHER">Other</option>
            </select>
          </label>
          <label>
            Offering
            <select name="transactionType" defaultValue="FOR_SALE">
              <option value="FOR_SALE">For sale</option>
              <option value="FOR_LEASE">For lease</option>
            </select>
          </label>
          <label>
            Asking price
            <input name="askingPrice" inputMode="decimal" defaultValue="1" required />
          </label>
          <label>
            Rent details
            <input name="askingRentText" placeholder="$45 / SF / year" />
          </label>
          <label>
            Hero photo
            <input name="heroPhoto" type="file" accept="image/jpeg,image/png,image/webp" required />
          </label>
          <div className="dialog-actions">
            <button type="button" className="button secondary" onClick={() => setParams({})}>
              Cancel
            </button>
            <button className="button primary" disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create & start email"}
            </button>
          </div>
          {create.error ? <ErrorBlock error={create.error} /> : null}
        </form>
      ) : null}
      <section className="panel-simple">
        <div className="table-toolbar">
          <label className="small-search">
            <Search size={16} />
            <span className="sr-only">Search properties</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search address or city"
            />
          </label>
          <span>{listings.data?.total ?? 0} properties</span>
        </div>
        {listings.isLoading ? (
          <LoadingBlock />
        ) : listings.error ? (
          <ErrorBlock error={listings.error} />
        ) : listings.data?.items.length ? (
          <div className="property-library-grid">
            {listings.data.items.map((listing) => (
              <article className="property-result" key={listing.id}>
                <div className="property-result-image">
                  {listing.assets?.[0]?.thumbnailUrl || listing.assets?.[0]?.publicUrl ? (
                    <img
                      src={listing.assets[0]!.thumbnailUrl ?? listing.assets[0]!.publicUrl}
                      alt=""
                    />
                  ) : (
                    <span>H</span>
                  )}
                </div>
                <div>
                  <span className="property-source">
                    {listing.source === "ONEKEY" ? "OneKey MLS" : "Manual"} ·{" "}
                    {listing.status.toLowerCase()}
                  </span>
                  <h3>{listing.addressLine1}</h3>
                  <p>
                    {listing.city}, {listing.stateCode} {listing.postalCode}
                  </p>
                </div>
                <button
                  className="button secondary"
                  disabled={start.isPending}
                  onClick={() => start.mutate(listing.id)}
                >
                  Create email <ArrowRight size={16} />
                </button>
              </article>
            ))}
          </div>
        ) : (
          <EmptyBlock title="No properties yet">
            Search OneKey from Home or create a property manually with a hero photo.
          </EmptyBlock>
        )}
        {start.error ? <ErrorBlock error={start.error} /> : null}
      </section>
    </Page>
  );
}
