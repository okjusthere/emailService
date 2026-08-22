import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  BarChart3,
  Building2,
  ContactRound,
  Gauge,
  LayoutDashboard,
  ListFilter,
  MailCheck,
  Megaphone,
  Menu,
  Settings2,
  X,
} from "lucide-react";
import { useEffect, useState, type FormEvent, type PropsWithChildren } from "react";
import { BrowserRouter, NavLink, Navigate, Route, Routes } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState, ErrorState, LoadingState, StatusPill } from "../components/States.js";
import { RichTextEditor } from "../components/RichTextEditor.js";
import { api, formatEt } from "../lib/api.js";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1 } },
});
type Me = {
  user: {
    id: string;
    email: string;
    displayName: string | null;
    role: "ADMIN" | "MARKETER" | "VIEWER";
  };
};
type ListResponse<T> = { items: T[]; total?: number };

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthGate />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

function AuthGate() {
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<Me>("/api/v2/auth/me"),
    retry: false,
  });
  if (me.isLoading)
    return (
      <div className="boot">
        <div className="brand-mark">H</div>
        <p>Opening the marketing desk…</p>
      </div>
    );
  if (me.isError) return <Login onSuccess={() => void me.refetch()} />;
  return <Shell user={me.data!.user} />;
}

function Login({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("admin@homixny.com");
  const login = useMutation({
    mutationFn: () =>
      api("/api/v2/auth/dev-login", { method: "POST", body: JSON.stringify({ email }) }),
    onSuccess,
  });
  return (
    <main className="login">
      <section className="login-panel">
        <div className="brand-mark">H</div>
        <span className="eyebrow">Homix Realty · Internal</span>
        <h1>Listing campaigns, without the guesswork.</h1>
        <p>
          Build a precise audience, review every detail, and follow delivery from queue to click.
        </p>
      </section>
      <form
        className="login-card"
        onSubmit={(event) => {
          event.preventDefault();
          login.mutate();
        }}
      >
        <span className="eyebrow">Local development</span>
        <h2>Enter the marketing desk</h2>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        {login.error ? <p className="form-error">{login.error.message}</p> : null}
        <button className="button primary" disabled={login.isPending}>
          {login.isPending ? "Signing in…" : "Continue"}
        </button>
        <p className="fine-print">
          Production uses Microsoft Entra ID; local login is disabled there.
        </p>
      </form>
    </main>
  );
}

const navigation = [
  ["/", "Dashboard", LayoutDashboard],
  ["/listings", "Listings", Building2],
  ["/contacts", "Contacts", ContactRound],
  ["/audiences", "Audiences", ListFilter],
  ["/campaigns", "Campaigns", Megaphone],
  ["/analytics", "Analytics", BarChart3],
  ["/settings", "Settings", Settings2],
] as const;

function Shell({ user }: { user: Me["user"] }) {
  const [menu, setMenu] = useState(false);
  return (
    <div className="shell">
      <aside className={menu ? "sidebar open" : "sidebar"}>
        <div className="sidebar-head">
          <div className="brand-mark small">H</div>
          <div>
            <strong>Homix</strong>
            <span>Marketing</span>
          </div>
          <button
            aria-label="Close navigation"
            className="icon-button mobile-only"
            onClick={() => setMenu(false)}
          >
            <X size={20} />
          </button>
        </div>
        <nav>
          {navigation.map(([to, label, Icon]) => (
            <NavLink key={to} to={to} end={to === "/"} onClick={() => setMenu(false)}>
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="user-chip">
          <span>{(user.displayName ?? user.email).slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{user.displayName ?? user.email}</strong>
            <small>{user.role}</small>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <button
            aria-label="Open navigation"
            className="icon-button mobile-only"
            onClick={() => setMenu(true)}
          >
            <Menu size={21} />
          </button>
          <p>
            <span className="live-dot" /> Delivery controls active
          </p>
          <span>All times shown in ET</span>
        </header>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/listings" element={<Listings />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/audiences" element={<Audiences />} />
          <Route path="/campaigns" element={<Campaigns />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/settings" element={<Settings user={user} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      {menu ? (
        <button className="scrim" aria-label="Close menu" onClick={() => setMenu(false)} />
      ) : null}
    </div>
  );
}

function Page({
  eyebrow,
  title,
  description,
  action,
  children,
}: PropsWithChildren<{
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}>) {
  return (
    <main className="page">
      <header className="page-head">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {action}
      </header>
      {children}
    </main>
  );
}

type Summary = {
  activeListings: number;
  contacts: number;
  eligibleContacts: number;
  suppressed: number;
  campaignsLast30Days: number;
  accepted: number;
  delivered: number;
  clicked: number;
  manualReview: number;
};
function Dashboard() {
  const summary = useQuery({
    queryKey: ["summary"],
    queryFn: () => api<Summary>("/api/v2/dashboard/summary"),
  });
  const recent = useQuery({
    queryKey: ["recent-campaigns"],
    queryFn: () => api<ListResponse<Campaign>>("/api/v2/dashboard/recent-campaigns"),
  });
  if (summary.isLoading)
    return (
      <Page
        eyebrow="Today"
        title="Marketing desk"
        description="Operational truth for listings, contacts, and sends."
      >
        <LoadingState />
      </Page>
    );
  if (summary.error)
    return (
      <Page
        eyebrow="Today"
        title="Marketing desk"
        description="Operational truth for listings, contacts, and sends."
      >
        <ErrorState error={summary.error} />
      </Page>
    );
  const data = summary.data!;
  const chart = [
    { name: "Accepted", value: data.accepted },
    { name: "Delivered", value: data.delivered },
    { name: "Clicked", value: data.clicked },
  ];
  return (
    <Page
      eyebrow="Today"
      title="Marketing desk"
      description="Operational truth for listings, contacts, and sends."
      action={
        <NavLink className="button primary" to="/campaigns">
          Create campaign
        </NavLink>
      }
    >
      <section className="metrics">
        <Metric label="Active listings" value={data.activeListings} note="Ready for marketing" />
        <Metric
          label="Eligible contacts"
          value={data.eligibleContacts}
          note={`${data.suppressed} globally suppressed`}
        />
        <Metric
          label="Campaigns · 30d"
          value={data.campaignsLast30Days}
          note={`${data.accepted} accepted`}
        />
        <Metric
          label="Action required"
          value={data.manualReview}
          note="Manual-review batches"
          alert={data.manualReview > 0}
        />
      </section>
      <section className="dashboard-grid">
        <article className="panel chart-panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">Delivery shape</span>
              <h2>Last 30 days</h2>
            </div>
            <Gauge size={22} />
          </div>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={chart}>
              <CartesianGrid vertical={false} stroke="#ddd8cc" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} />
              <YAxis axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: "#f1eee6" }} />
              <Bar dataKey="value" fill="#c2703d" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </article>
        <article className="panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">Campaigns</span>
              <h2>Recently touched</h2>
            </div>
            <MailCheck size={22} />
          </div>
          {recent.data?.items.length ? (
            <div className="stack-list">
              {recent.data.items.map((campaign) => (
                <div key={campaign.id}>
                  <div>
                    <strong>{campaign.name}</strong>
                    <span>{campaign.listing?.title ?? "No listing"}</span>
                  </div>
                  <StatusPill value={campaign.status} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="Your first campaign starts with a listing">
              Create a listing, choose an audience, and send a test.
            </EmptyState>
          )}
        </article>
      </section>
    </Page>
  );
}

function Metric({
  label,
  value,
  note,
  alert,
}: {
  label: string;
  value: number;
  note: string;
  alert?: boolean;
}) {
  return (
    <article className={alert ? "metric alert" : "metric"}>
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
      <small>{note}</small>
    </article>
  );
}

type Listing = {
  id: string;
  internalName: string;
  title: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  stateCode: string;
  postalCode: string;
  propertyType: string;
  transactionType: string;
  askingPrice?: string;
  askingRentText?: string;
  priceUponRequest: boolean;
  buildingSqFt?: number;
  lotSqFt?: string;
  zoning?: string;
  shortDescription?: string;
  longDescription?: string;
  highlights: string[];
  listingUrl?: string;
  isExclusive: boolean;
  agentId: string;
  status: string;
  updatedAt: string;
  agent: { displayName: string };
  assets: Array<{
    id: string;
    thumbnailUrl?: string;
    publicUrl: string;
    kind: string;
    originalFileName?: string;
    sortOrder: number;
  }>;
  _count: { campaigns: number };
};
function Listings() {
  const client = useQueryClient();
  const [editor, setEditor] = useState(false);
  const [search, setSearch] = useState("");
  const [listingFilters, setListingFilters] = useState({
    status: "",
    propertyType: "",
    transactionType: "",
    agentId: "",
  });
  const listingQuery = new URLSearchParams({ limit: "100", search, ...listingFilters });
  for (const [key, value] of [...listingQuery.entries()]) if (!value) listingQuery.delete(key);
  const listings = useQuery({
    queryKey: ["listings", listingQuery.toString()],
    queryFn: () => api<ListResponse<Listing>>(`/api/v2/listings?${listingQuery}`),
  });
  const agents = useQuery({
    queryKey: ["listing-agents"],
    queryFn: () => api<ListResponse<{ id: string; displayName: string }>>("/api/v2/agents"),
  });
  const create = useMutation({
    mutationFn: async (form: FormData) => {
      const desiredStatus = String(form.get("status") ?? "DRAFT");
      const title = String(form.get("title") ?? "").trim();
      const listing = await api<{ id: string }>("/api/v2/listings", {
        method: "POST",
        body: JSON.stringify({
          internalName: String(form.get("internalName") ?? title),
          title,
          slug: `${title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")}-${Date.now().toString(36)}`,
          status: "DRAFT",
          transactionType: form.get("transactionType"),
          propertyType: form.get("propertyType"),
          addressLine1: form.get("addressLine1"),
          city: form.get("city"),
          stateCode: form.get("stateCode"),
          postalCode: form.get("postalCode"),
          askingPrice: form.get("askingPrice") || null,
          priceUponRequest: form.get("priceUponRequest") === "on",
          buildingSqFt: form.get("buildingSqFt") ? Number(form.get("buildingSqFt")) : null,
          shortDescription: form.get("shortDescription") || null,
          highlights: String(form.get("highlights") ?? "")
            .split("\n")
            .map((item) => item.trim())
            .filter(Boolean),
          listingUrl: form.get("listingUrl") || null,
          isExclusive: form.get("isExclusive") === "on",
          agentId: form.get("agentId"),
        }),
      });
      const hero = form.get("hero");
      if (hero instanceof File && hero.size > 0) {
        const assetBody = new FormData();
        assetBody.set("file", hero);
        assetBody.set("kind", "HERO");
        assetBody.set("altText", `${title} hero image`);
        await api(`/api/v2/listings/${listing.id}/assets`, { method: "POST", body: assetBody });
      }
      if (desiredStatus === "ACTIVE") {
        await api(`/api/v2/listings/${listing.id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "ACTIVE" }),
        });
      }
      return listing;
    },
    onSuccess: () => {
      setEditor(false);
      void client.invalidateQueries({ queryKey: ["listings"] });
    },
  });
  const listingAction = useMutation({
    mutationFn: async (input: {
      listing: Listing;
      action: "archive" | "duplicate" | "edit" | "asset-delete" | "asset-reorder" | "upload";
      assetId?: string;
      title?: string;
      form?: FormData;
      assets?: Listing["assets"];
    }) => {
      const { listing, action } = input;
      if (action === "archive" || action === "duplicate")
        return api(`/api/v2/listings/${listing.id}/${action}`, {
          method: "POST",
          body: JSON.stringify({}),
        });
      if (action === "edit") {
        const form = input.form!;
        return api(`/api/v2/listings/${listing.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            internalName: form.get("internalName"),
            title: form.get("title"),
            status: form.get("status"),
            transactionType: form.get("transactionType"),
            propertyType: form.get("propertyType"),
            addressLine1: form.get("addressLine1"),
            addressLine2: form.get("addressLine2") || null,
            city: form.get("city"),
            stateCode: form.get("stateCode"),
            postalCode: form.get("postalCode"),
            askingPrice: form.get("askingPrice") || null,
            askingRentText: form.get("askingRentText") || null,
            priceUponRequest: form.get("priceUponRequest") === "on",
            buildingSqFt: form.get("buildingSqFt") ? Number(form.get("buildingSqFt")) : null,
            lotSqFt: form.get("lotSqFt") || null,
            zoning: form.get("zoning") || null,
            shortDescription: form.get("shortDescription") || null,
            longDescription: form.get("longDescription") || null,
            highlights: String(form.get("highlights") ?? "")
              .split("\n")
              .map((value) => value.trim())
              .filter(Boolean),
            listingUrl: form.get("listingUrl") || null,
            isExclusive: form.get("isExclusive") === "on",
            agentId: form.get("agentId"),
          }),
        });
      }
      if (action === "asset-delete")
        return api(`/api/v2/listings/${listing.id}/assets/${input.assetId}`, { method: "DELETE" });
      if (action === "asset-reorder")
        return api(`/api/v2/listings/${listing.id}/assets/reorder`, {
          method: "PATCH",
          body: JSON.stringify({
            assets: input.assets?.map((asset, sortOrder) => ({ id: asset.id, sortOrder })),
          }),
        });
      return api(`/api/v2/listings/${listing.id}/assets`, {
        method: "POST",
        body: input.form,
      });
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: ["listings"] }),
  });
  return (
    <Page
      eyebrow="Inventory"
      title="Listings"
      description="Property facts and marketing assets stay together from draft through archive."
      action={
        <button className="button primary" onClick={() => setEditor((value) => !value)}>
          {editor ? "Close editor" : "New listing"}
        </button>
      }
    >
      {editor ? (
        <form
          id="listing-editor"
          className="panel editor-form"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate(new FormData(event.currentTarget));
          }}
        >
          <div className="panel-head">
            <div>
              <span className="eyebrow">Property editor</span>
              <h2>Create a listing</h2>
            </div>
            <span>Hero images are converted to email-safe JPEGs.</span>
          </div>
          <div className="form-grid">
            <label>
              Internal name
              <input name="internalName" required />
            </label>
            <label>
              Marketing title
              <input name="title" required />
            </label>
            <label>
              Agent
              <select name="agentId" required defaultValue="">
                <option value="" disabled>
                  Select agent
                </option>
                {agents.data?.items.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Property type
              <select name="propertyType" defaultValue="RETAIL">
                {[
                  "OFFICE",
                  "RETAIL",
                  "INDUSTRIAL",
                  "MULTIFAMILY",
                  "LAND",
                  "MIXED_USE",
                  "HOSPITALITY",
                  "SPECIAL_PURPOSE",
                  "BUSINESS",
                  "RESIDENTIAL",
                  "OTHER",
                ].map((value) => (
                  <option key={value} value={value}>
                    {value.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Transaction
              <select name="transactionType" defaultValue="FOR_SALE">
                <option value="FOR_SALE">For sale</option>
                <option value="FOR_LEASE">For lease</option>
                <option value="SALE_OR_LEASE">Sale or lease</option>
              </select>
            </label>
            <label>
              Address
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
              Postal code
              <input name="postalCode" required />
            </label>
            <label>
              Asking price
              <input name="askingPrice" inputMode="decimal" />
            </label>
            <label>
              Building SF
              <input name="buildingSqFt" type="number" min="1" />
            </label>
            <label>
              Listing URL
              <input name="listingUrl" type="url" placeholder="https://…" />
            </label>
            <label>
              Hero image
              <input name="hero" type="file" accept="image/jpeg,image/png,image/webp" />
            </label>
            <label>
              Initial status
              <select name="status" defaultValue="DRAFT">
                <option value="DRAFT">Draft</option>
                <option value="ACTIVE">Active after hero upload</option>
              </select>
            </label>
          </div>
          <label>
            Short description
            <textarea name="shortDescription" rows={3} />
          </label>
          <label>
            Highlights
            <textarea name="highlights" rows={4} placeholder="One highlight per line" />
          </label>
          <div className="check-row">
            <input name="priceUponRequest" type="checkbox" /> Price upon request
            <input name="isExclusive" type="checkbox" /> Exclusive listing
          </div>
          {create.error ? <p className="form-error">{create.error.message}</p> : null}
          <button className="button primary" disabled={create.isPending}>
            {create.isPending ? "Saving listing…" : "Save listing"}
          </button>
        </form>
      ) : null}
      <section className="panel toolbar">
        <input
          className="search"
          placeholder="Search title, address, or city"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          aria-label="Listing status"
          value={listingFilters.status}
          onChange={(event) =>
            setListingFilters((current) => ({ ...current, status: event.target.value }))
          }
        >
          <option value="">All statuses</option>
          {["DRAFT", "ACTIVE", "UNDER_CONTRACT", "CLOSED", "ARCHIVED"].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <select
          aria-label="Listing property type"
          value={listingFilters.propertyType}
          onChange={(event) =>
            setListingFilters((current) => ({ ...current, propertyType: event.target.value }))
          }
        >
          <option value="">All property types</option>
          {[
            "OFFICE",
            "RETAIL",
            "INDUSTRIAL",
            "MULTIFAMILY",
            "LAND",
            "MIXED_USE",
            "HOSPITALITY",
            "SPECIAL_PURPOSE",
            "BUSINESS",
            "RESIDENTIAL",
            "OTHER",
          ].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <select
          aria-label="Listing transaction type"
          value={listingFilters.transactionType}
          onChange={(event) =>
            setListingFilters((current) => ({ ...current, transactionType: event.target.value }))
          }
        >
          <option value="">All transactions</option>
          {["FOR_SALE", "FOR_LEASE", "SALE_OR_LEASE"].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <select
          aria-label="Listing agent"
          value={listingFilters.agentId}
          onChange={(event) =>
            setListingFilters((current) => ({ ...current, agentId: event.target.value }))
          }
        >
          <option value="">All agents</option>
          {agents.data?.items.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.displayName}
            </option>
          ))}
        </select>
      </section>
      {listings.isLoading ? (
        <LoadingState />
      ) : listings.error ? (
        <ErrorState error={listings.error} />
      ) : listings.data!.items.length ? (
        <div className="card-grid">
          {listings.data!.items.map((listing) => (
            <article className="listing-card" key={listing.id}>
              {listing.assets[0] ? (
                <img src={listing.assets[0].thumbnailUrl ?? listing.assets[0].publicUrl} alt="" />
              ) : (
                <div className="image-placeholder">HOMIX</div>
              )}
              <div>
                <div className="row">
                  <StatusPill value={listing.status} />
                  <small>{listing._count.campaigns} campaigns</small>
                </div>
                <h2>{listing.title}</h2>
                <p>
                  {listing.addressLine1}, {listing.city}, {listing.stateCode}
                </p>
                <footer>
                  <span>{listing.propertyType.replaceAll("_", " ")}</span>
                  <span>{formatEt(listing.updatedAt)}</span>
                </footer>
                <details>
                  <summary>Manage listing</summary>
                  <div className="toolbar">
                    <button
                      className="text-button"
                      onClick={() => listingAction.mutate({ listing, action: "duplicate" })}
                    >
                      Duplicate
                    </button>
                    {listing.status !== "ARCHIVED" ? (
                      <button
                        className="text-button danger"
                        onClick={() => {
                          if (window.confirm(`Archive ${listing.title}?`))
                            listingAction.mutate({ listing, action: "archive" });
                        }}
                      >
                        Archive
                      </button>
                    ) : null}
                  </div>
                  <form
                    className="form-grid listing-inline-editor"
                    onSubmit={(event) => {
                      event.preventDefault();
                      listingAction.mutate({
                        listing,
                        action: "edit",
                        form: new FormData(event.currentTarget),
                      });
                    }}
                  >
                    <input
                      name="internalName"
                      aria-label="Internal name"
                      defaultValue={listing.internalName}
                      required
                    />
                    <input
                      name="title"
                      aria-label="Marketing title"
                      defaultValue={listing.title}
                      required
                    />
                    <input
                      name="addressLine1"
                      aria-label="Address"
                      defaultValue={listing.addressLine1}
                      required
                    />
                    <input
                      name="addressLine2"
                      aria-label="Address line 2"
                      defaultValue={listing.addressLine2}
                    />
                    <input name="city" aria-label="City" defaultValue={listing.city} required />
                    <input
                      name="stateCode"
                      aria-label="State"
                      defaultValue={listing.stateCode}
                      maxLength={2}
                      required
                    />
                    <input
                      name="postalCode"
                      aria-label="Postal code"
                      defaultValue={listing.postalCode}
                      required
                    />
                    <select
                      name="propertyType"
                      aria-label="Property type"
                      defaultValue={listing.propertyType}
                    >
                      {[
                        "OFFICE",
                        "RETAIL",
                        "INDUSTRIAL",
                        "MULTIFAMILY",
                        "LAND",
                        "MIXED_USE",
                        "HOSPITALITY",
                        "SPECIAL_PURPOSE",
                        "BUSINESS",
                        "RESIDENTIAL",
                        "OTHER",
                      ].map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                    <select
                      name="transactionType"
                      aria-label="Transaction type"
                      defaultValue={listing.transactionType}
                    >
                      {["FOR_SALE", "FOR_LEASE", "SALE_OR_LEASE"].map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                    <input
                      name="askingPrice"
                      aria-label="Asking price"
                      defaultValue={listing.askingPrice ?? ""}
                    />
                    <input
                      name="askingRentText"
                      aria-label="Asking rent"
                      defaultValue={listing.askingRentText ?? ""}
                    />
                    <input
                      name="buildingSqFt"
                      type="number"
                      aria-label="Building square feet"
                      defaultValue={listing.buildingSqFt ?? ""}
                    />
                    <input
                      name="lotSqFt"
                      aria-label="Lot square feet"
                      defaultValue={listing.lotSqFt ?? ""}
                    />
                    <input name="zoning" aria-label="Zoning" defaultValue={listing.zoning ?? ""} />
                    <input
                      name="listingUrl"
                      type="url"
                      aria-label="Listing URL"
                      defaultValue={listing.listingUrl ?? ""}
                    />
                    <select name="agentId" aria-label="Agent" defaultValue={listing.agentId}>
                      {agents.data?.items.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.displayName}
                        </option>
                      ))}
                    </select>
                    <select
                      name="status"
                      aria-label="Publication status"
                      defaultValue={listing.status}
                    >
                      {["DRAFT", "ACTIVE", "UNDER_CONTRACT", "CLOSED", "ARCHIVED"].map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                    <textarea
                      name="shortDescription"
                      aria-label="Short description"
                      defaultValue={listing.shortDescription ?? ""}
                    />
                    <textarea
                      name="longDescription"
                      aria-label="Long description"
                      defaultValue={listing.longDescription ?? ""}
                    />
                    <textarea
                      name="highlights"
                      aria-label="Highlights"
                      defaultValue={listing.highlights.join("\n")}
                    />
                    <label className="check-row">
                      <input
                        name="priceUponRequest"
                        type="checkbox"
                        defaultChecked={listing.priceUponRequest}
                      />{" "}
                      Price upon request
                    </label>
                    <label className="check-row">
                      <input
                        name="isExclusive"
                        type="checkbox"
                        defaultChecked={listing.isExclusive}
                      />{" "}
                      Exclusive
                    </label>
                    <button className="button secondary" disabled={listingAction.isPending}>
                      Save listing details
                    </button>
                  </form>
                  <form
                    className="toolbar"
                    onSubmit={(event) => {
                      event.preventDefault();
                      listingAction.mutate({
                        listing,
                        action: "upload",
                        form: new FormData(event.currentTarget),
                      });
                    }}
                  >
                    <input
                      name="file"
                      type="file"
                      aria-label={`Upload asset for ${listing.title}`}
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      required
                    />
                    <select name="kind" defaultValue="GALLERY" aria-label="Asset kind">
                      <option value="HERO">Hero</option>
                      <option value="GALLERY">Gallery</option>
                      <option value="FLOORPLAN">Floorplan</option>
                      <option value="BROCHURE">Brochure PDF</option>
                    </select>
                    <button className="text-button">Upload</button>
                  </form>
                  <div className="stack-list">
                    {listing.assets.map((asset, index) => (
                      <div key={asset.id}>
                        <span>
                          {asset.kind.replaceAll("_", " ")} · {asset.originalFileName ?? "asset"}
                        </span>
                        <span className="toolbar">
                          {index > 0 ? (
                            <button
                              className="text-button"
                              aria-label={`Move ${asset.kind} up`}
                              onClick={() => {
                                const reordered = [...listing.assets];
                                [reordered[index - 1], reordered[index]] = [
                                  reordered[index]!,
                                  reordered[index - 1]!,
                                ];
                                listingAction.mutate({
                                  listing,
                                  action: "asset-reorder",
                                  assets: reordered,
                                });
                              }}
                            >
                              ↑
                            </button>
                          ) : null}
                          <button
                            className="text-button danger"
                            onClick={() =>
                              listingAction.mutate({
                                listing,
                                action: "asset-delete",
                                assetId: asset.id,
                              })
                            }
                          >
                            Delete
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
                {listingAction.error ? (
                  <p className="form-error">{listingAction.error.message}</p>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState title="Add the first listing">
          Upload a hero image and complete the property facts before activation.
        </EmptyState>
      )}
    </Page>
  );
}

type Contact = {
  id: string;
  email: string;
  displayName?: string;
  company?: string;
  contactType: string;
  sourceType: string;
  permissionBasis: string;
  status: string;
  suppressed: boolean;
  suppressionReason?: string;
  lastEngagedAt?: string;
  lastSentAt?: string;
  updatedAt: string;
};
const importColumns = [
  "email",
  "first_name",
  "last_name",
  "name",
  "company",
  "title",
  "phone",
  "contact_type",
  "source_detail",
  "permission_basis",
  "markets",
  "property_interests",
  "tags",
  "notes",
] as const;
type ImportValidation = {
  totalRows: number;
  valid: number;
  invalid: number;
  duplicates: number;
  suppressed: number;
  mapping: Record<string, string>;
  unknownReferences: { tags: string[]; markets: string[]; propertyInterests: string[] };
  preview: Array<{ email: string; name: string; company: string }>;
};
function Contacts() {
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedContactId, setSelectedContactId] = useState("");
  const [filters, setFilters] = useState({
    contactType: "",
    sourceType: "",
    permissionBasis: "",
    status: "",
    marketId: "",
    propertyInterestId: "",
    tagId: "",
    suppressed: "",
    sort: "createdAt",
    order: "desc",
  });
  const [importResult, setImportResult] = useState("");
  const [importId, setImportId] = useState("");
  const [importHeaders, setImportHeaders] = useState<string[]>([]);
  const [importMapping, setImportMapping] = useState<Record<string, string>>({});
  const [importValidation, setImportValidation] = useState<ImportValidation | null>(null);
  const [confirmUnknownReferences, setConfirmUnknownReferences] = useState(false);
  const contactQuery = new URLSearchParams({ limit: "25", page: String(page), ...filters });
  if (search) contactQuery.set("search", search);
  for (const [key, value] of [...contactQuery.entries()]) if (!value) contactQuery.delete(key);
  const contacts = useQuery({
    queryKey: ["contacts", contactQuery.toString()],
    queryFn: () =>
      api<ListResponse<Contact> & { page: number; limit: number; nextCursor?: string | null }>(
        `/api/v2/contacts?${contactQuery.toString()}`
      ),
  });
  const contactReferences = useQuery({
    queryKey: ["contact-reference"],
    queryFn: async () => {
      const [tags, markets, interests] = await Promise.all([
        api<ListResponse<{ id: string; name: string }>>("/api/v2/tags"),
        api<ListResponse<{ id: string; name: string }>>("/api/v2/markets"),
        api<ListResponse<{ id: string; name: string }>>("/api/v2/property-interests"),
      ]);
      return { tags: tags.items, markets: markets.items, interests: interests.items };
    },
  });
  const contactDetail = useQuery({
    queryKey: ["contact-detail", selectedContactId],
    queryFn: () =>
      api<
        Contact & {
          suppression?: { reason: string; suppressedAt: string };
          campaignRecipients: Array<{
            id: string;
            sendState: string;
            deliveryState: string;
            acceptedAt?: string;
            openedAt?: string;
            clickedAt?: string;
            campaign: { name: string; status: string };
          }>;
        }
      >(`/api/v2/contacts/${selectedContactId}`),
    enabled: Boolean(selectedContactId),
  });
  const create = useMutation({
    mutationFn: (form: FormData) =>
      api("/api/v2/contacts", {
        method: "POST",
        body: JSON.stringify({
          email: form.get("email"),
          displayName: form.get("name") || undefined,
          company: form.get("company") || undefined,
          contactType: form.get("contactType"),
          sourceType: "MANUAL",
          permissionBasis: form.get("permissionBasis"),
        }),
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["contacts"] }),
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    create.mutate(new FormData(event.currentTarget));
    event.currentTarget.reset();
  };
  const contactImport = useMutation({
    mutationFn: async (form: FormData) => {
      const uploadBody = new FormData();
      const file = form.get("file");
      if (!(file instanceof File) || file.size === 0) throw new Error("Choose a CSV file.");
      uploadBody.set("file", file);
      uploadBody.set("sourceType", String(form.get("sourceType")));
      uploadBody.set("permissionBasis", String(form.get("permissionBasis")));
      uploadBody.set("sourceDetail", String(form.get("sourceDetail") ?? ""));
      return api<{
        id: string;
        inspection: {
          headers: string[];
          mapping: Record<string, string>;
          preview: Array<Record<string, string>>;
        };
      }>("/api/v2/contact-imports/upload", {
        method: "POST",
        body: uploadBody,
      });
    },
    onSuccess: (item) => {
      setImportId(item.id);
      setImportHeaders(item.inspection.headers);
      setImportMapping(item.inspection.mapping);
      setImportValidation(null);
      setConfirmUnknownReferences(false);
      setImportResult("Upload complete. Review the column mapping before validation.");
    },
  });
  const validateImport = useMutation({
    mutationFn: () =>
      api<ImportValidation>(`/api/v2/contact-imports/${importId}/validate`, {
        method: "POST",
        body: JSON.stringify({ mapping: importMapping }),
      }),
    onSuccess: (validation) => {
      setImportValidation(validation);
      setConfirmUnknownReferences(false);
      setImportResult("Validation complete. Review the summary before applying the import.");
    },
  });
  const applyImport = useMutation({
    mutationFn: () =>
      api(`/api/v2/contact-imports/${importId}/apply`, {
        method: "POST",
        body: JSON.stringify({ confirmCreateUnknownReferences: confirmUnknownReferences }),
      }),
    onSuccess: () => setImportResult("Import queued for Worker processing."),
  });
  const importStatus = useQuery({
    queryKey: ["contact-import", importId],
    queryFn: () =>
      api<{
        status: string;
        totalRows: number;
        createdCount: number;
        updatedCount: number;
        skippedCount: number;
        invalidCount: number;
        suppressedCount: number;
        errorReportUrl?: string;
      }>(`/api/v2/contact-imports/${importId}`),
    enabled: Boolean(importId) && applyImport.isSuccess,
    refetchInterval: (query) => (query.state.data?.status === "PROCESSING" ? 1_000 : false),
  });
  const contactAction = useMutation({
    mutationFn: async (input: { contact: Contact; action: "edit" | "archive" | "restore" }) => {
      if (input.action === "archive")
        return api(`/api/v2/contacts/${input.contact.id}`, { method: "DELETE" });
      if (input.action === "restore")
        return api(`/api/v2/contacts/${input.contact.id}/restore`, {
          method: "POST",
          body: JSON.stringify({}),
        });
      const displayName = window.prompt("Contact name", input.contact.displayName ?? "")?.trim();
      if (displayName === undefined) return;
      const company = window.prompt("Company", input.contact.company ?? "")?.trim();
      if (company === undefined) return;
      return api(`/api/v2/contacts/${input.contact.id}`, {
        method: "PATCH",
        body: JSON.stringify({ displayName: displayName || null, company: company || null }),
      });
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: ["contacts"] }),
  });
  const bulkAction = useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      api("/api/v2/contacts/bulk-update", {
        method: "POST",
        body: JSON.stringify({ ids: selectedIds, ...input }),
      }),
    onSuccess: () => {
      setSelectedIds([]);
      void client.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
  const updateFilter = (key: keyof typeof filters, value: string) => {
    setPage(1);
    setSelectedIds([]);
    setFilters((current) => ({ ...current, [key]: value }));
  };
  return (
    <Page
      eyebrow="Relationships"
      title="Contacts"
      description="Source, permission, market, and suppression remain visible—not buried in tags."
    >
      <section className="split">
        <article className="panel grow">
          <div className="toolbar">
            <input
              className="search"
              placeholder="Search name, email, or company"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
            <a className="button secondary" href={`/api/v2/contacts/export?${contactQuery}`}>
              Export CSV
            </a>
          </div>
          <div className="form-grid audience-fields">
            <select
              aria-label="Contact type"
              value={filters.contactType}
              onChange={(event) => updateFilter("contactType", event.target.value)}
            >
              <option value="">All contact types</option>
              {[
                "BUYER",
                "SELLER",
                "INVESTOR",
                "BROKER",
                "TENANT",
                "LANDLORD",
                "DEVELOPER",
                "LENDER",
                "ATTORNEY",
                "VENDOR",
                "PAST_CLIENT",
                "OTHER",
              ].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <select
              aria-label="Contact source"
              value={filters.sourceType}
              onChange={(event) => updateFilter("sourceType", event.target.value)}
            >
              <option value="">All sources</option>
              {[
                "PAST_CLIENT",
                "OPEN_HOUSE",
                "WEBSITE",
                "BROKER_RELATIONSHIP",
                "EVENT",
                "CRM_IMPORT",
                "MANUAL",
                "REFERRAL",
                "LEGACY_EMAIL_SERVICE",
                "OTHER",
              ].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <select
              aria-label="Permission basis"
              value={filters.permissionBasis}
              onChange={(event) => updateFilter("permissionBasis", event.target.value)}
            >
              <option value="">All permission bases</option>
              {["OPT_IN", "EXISTING_RELATIONSHIP", "BUSINESS_CONTACT", "UNKNOWN"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <select
              aria-label="Contact status"
              value={filters.status}
              onChange={(event) => updateFilter("status", event.target.value)}
            >
              <option value="">All statuses</option>
              {["ACTIVE", "INACTIVE", "ARCHIVED"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <select
              aria-label="Market"
              value={filters.marketId}
              onChange={(event) => updateFilter("marketId", event.target.value)}
            >
              <option value="">All markets</option>
              {contactReferences.data?.markets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Property interest"
              value={filters.propertyInterestId}
              onChange={(event) => updateFilter("propertyInterestId", event.target.value)}
            >
              <option value="">All interests</option>
              {contactReferences.data?.interests.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Tag"
              value={filters.tagId}
              onChange={(event) => updateFilter("tagId", event.target.value)}
            >
              <option value="">All tags</option>
              {contactReferences.data?.tags.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Suppression"
              value={filters.suppressed}
              onChange={(event) => updateFilter("suppressed", event.target.value)}
            >
              <option value="">Any suppression</option>
              <option value="false">Eligible only</option>
              <option value="true">Suppressed only</option>
            </select>
            <select
              aria-label="Sort contacts"
              value={`${filters.sort}:${filters.order}`}
              onChange={(event) => {
                const [sort, order] = event.target.value.split(":");
                setFilters((current) => ({ ...current, sort: sort!, order: order! }));
              }}
            >
              <option value="createdAt:desc">Newest created</option>
              <option value="createdAt:asc">Oldest created</option>
              <option value="lastEngagedAt:desc">Recently engaged</option>
              <option value="lastSentAt:desc">Recently sent</option>
            </select>
          </div>
          {selectedIds.length ? (
            <div className="toolbar" aria-label="Bulk contact actions">
              <strong>{selectedIds.length} selected</strong>
              <select
                aria-label="Add tag"
                defaultValue=""
                onChange={(event) => {
                  if (event.target.value)
                    bulkAction.mutate({ relationshipMode: "add", tagIds: [event.target.value] });
                  event.currentTarget.value = "";
                }}
              >
                <option value="">Add tag…</option>
                {contactReferences.data?.tags.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Add market"
                defaultValue=""
                onChange={(event) => {
                  if (event.target.value)
                    bulkAction.mutate({ relationshipMode: "add", marketIds: [event.target.value] });
                  event.currentTarget.value = "";
                }}
              >
                <option value="">Add market…</option>
                {contactReferences.data?.markets.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Add property interest"
                defaultValue=""
                onChange={(event) => {
                  if (event.target.value)
                    bulkAction.mutate({
                      relationshipMode: "add",
                      propertyInterestIds: [event.target.value],
                    });
                  event.currentTarget.value = "";
                }}
              >
                <option value="">Add interest…</option>
                {contactReferences.data?.interests.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <button
                className="text-button danger"
                onClick={() => bulkAction.mutate({ status: "ARCHIVED" })}
              >
                Archive selected
              </button>
            </div>
          ) : null}
          {contacts.isLoading ? (
            <LoadingState />
          ) : contacts.error ? (
            <ErrorState error={contacts.error} />
          ) : (
            <DataTable
              headers={[
                "Select",
                "Contact",
                "Company",
                "Type",
                "Permission",
                "Eligibility",
                "Actions",
              ]}
            >
              {contacts.data!.items.map((contact) => (
                <tr key={contact.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${contact.email}`}
                      checked={selectedIds.includes(contact.id)}
                      onChange={(event) =>
                        setSelectedIds((current) =>
                          event.target.checked
                            ? [...current, contact.id]
                            : current.filter((id) => id !== contact.id)
                        )
                      }
                    />
                  </td>
                  <td>
                    <strong>{contact.displayName ?? "Unnamed contact"}</strong>
                    <small>{contact.email}</small>
                  </td>
                  <td>{contact.company ?? "—"}</td>
                  <td>{contact.contactType.replaceAll("_", " ")}</td>
                  <td>{contact.permissionBasis.replaceAll("_", " ")}</td>
                  <td>
                    {contact.suppressed ? (
                      <StatusPill value={contact.suppressionReason ?? "SUPPRESSED"} />
                    ) : (
                      <StatusPill value="ELIGIBLE" />
                    )}
                  </td>
                  <td>
                    <div className="toolbar">
                      <button
                        className="text-button"
                        onClick={() => setSelectedContactId(contact.id)}
                      >
                        History
                      </button>
                      <button
                        className="text-button"
                        onClick={() => contactAction.mutate({ contact, action: "edit" })}
                      >
                        Edit
                      </button>
                      <button
                        className="text-button danger"
                        onClick={() =>
                          contactAction.mutate({
                            contact,
                            action: contact.status === "ARCHIVED" ? "restore" : "archive",
                          })
                        }
                      >
                        {contact.status === "ARCHIVED" ? "Restore" : "Archive"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
          <div className="toolbar pagination">
            <button
              className="text-button"
              disabled={page <= 1}
              onClick={() => setPage((value) => value - 1)}
            >
              Previous
            </button>
            <span>
              Page {page} · {contacts.data?.total ?? 0} contacts
            </span>
            <button
              className="text-button"
              disabled={page * 25 >= (contacts.data?.total ?? 0)}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </button>
          </div>
        </article>
        <form className="panel compact-form" onSubmit={submit}>
          <span className="eyebrow">Quick add</span>
          <h2>Known contact</h2>
          <label>
            Email
            <input name="email" type="email" required />
          </label>
          <label>
            Name
            <input name="name" />
          </label>
          <label>
            Company
            <input name="company" />
          </label>
          <label>
            Relationship
            <select name="contactType">
              <option value="BROKER">Broker</option>
              <option value="INVESTOR">Investor</option>
              <option value="PAST_CLIENT">Past client</option>
              <option value="OTHER">Other</option>
            </select>
          </label>
          <label>
            Permission basis
            <select name="permissionBasis">
              <option value="UNKNOWN">Unknown — excluded live</option>
              <option value="BUSINESS_CONTACT">Business contact</option>
              <option value="EXISTING_RELATIONSHIP">Existing relationship</option>
              <option value="OPT_IN">Opt in</option>
            </select>
          </label>
          {create.error ? <p className="form-error">{create.error.message}</p> : null}
          <button className="button primary" disabled={create.isPending}>
            Add contact
          </button>
        </form>
      </section>
      {selectedContactId ? (
        <section className="panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">Contact history</span>
              <h2>{contactDetail.data?.displayName ?? contactDetail.data?.email ?? "Loading…"}</h2>
            </div>
            <button className="text-button" onClick={() => setSelectedContactId("")}>
              Close
            </button>
          </div>
          {contactDetail.isLoading ? (
            <LoadingState />
          ) : contactDetail.error ? (
            <ErrorState error={contactDetail.error} />
          ) : (
            <>
              <p>
                Last engaged {formatEt(contactDetail.data?.lastEngagedAt)} · last sent{" "}
                {formatEt(contactDetail.data?.lastSentAt)}
                {contactDetail.data?.suppression
                  ? ` · suppressed: ${contactDetail.data.suppression.reason}`
                  : ""}
              </p>
              {contactDetail.data?.campaignRecipients.length ? (
                <DataTable
                  headers={[
                    "Campaign",
                    "Campaign status",
                    "Send",
                    "Delivery",
                    "Accepted",
                    "Opened",
                    "Clicked",
                  ]}
                >
                  {contactDetail.data.campaignRecipients.map((recipient) => (
                    <tr key={recipient.id}>
                      <td>{recipient.campaign.name}</td>
                      <td>
                        <StatusPill value={recipient.campaign.status} />
                      </td>
                      <td>
                        <StatusPill value={recipient.sendState} />
                      </td>
                      <td>
                        <StatusPill value={recipient.deliveryState} />
                      </td>
                      <td>{formatEt(recipient.acceptedAt)}</td>
                      <td>{formatEt(recipient.openedAt)}</td>
                      <td>{formatEt(recipient.clickedAt)}</td>
                    </tr>
                  ))}
                </DataTable>
              ) : (
                <EmptyState title="No campaign history">
                  This contact has not entered a campaign snapshot.
                </EmptyState>
              )}
            </>
          )}
        </section>
      ) : null}
      <form
        className="panel import-panel"
        onSubmit={(event) => {
          event.preventDefault();
          contactImport.mutate(new FormData(event.currentTarget));
        }}
      >
        <div>
          <span className="eyebrow">CSV workflow</span>
          <h2>1. Upload CSV</h2>
          <p>
            Required column: <code>email</code>. Optional relationship columns include name,
            company, tags, markets, and property interests.
          </p>
        </div>
        <label>
          CSV file
          <input name="file" type="file" accept=".csv,text/csv" required />
        </label>
        <label>
          Source
          <select name="sourceType" defaultValue="CRM_IMPORT">
            <option value="CRM_IMPORT">CRM import</option>
            <option value="PAST_CLIENT">Past client</option>
            <option value="OPEN_HOUSE">Open house</option>
            <option value="BROKER_RELATIONSHIP">Broker relationship</option>
            <option value="EVENT">Event</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
        <label>
          Permission basis
          <select name="permissionBasis" defaultValue="UNKNOWN">
            <option value="UNKNOWN">Unknown — excluded live</option>
            <option value="BUSINESS_CONTACT">Business contact</option>
            <option value="EXISTING_RELATIONSHIP">Existing relationship</option>
            <option value="OPT_IN">Opt in</option>
          </select>
        </label>
        <label>
          Source detail
          <input name="sourceDetail" placeholder="CRM export · Aug 2026" />
        </label>
        <button className="button primary" disabled={contactImport.isPending}>
          {contactImport.isPending ? "Uploading…" : "Upload and preview"}
        </button>
        {contactImport.error ? <p className="form-error">{contactImport.error.message}</p> : null}
      </form>
      {importId ? (
        <section className="panel import-panel">
          <div>
            <span className="eyebrow">CSV workflow</span>
            <h2>2. Map and preview columns</h2>
            <p>Map each supported field to a CSV header. Email is required.</p>
          </div>
          <div className="form-grid audience-fields">
            {importColumns.map((column) => (
              <label key={column}>
                {column.replaceAll("_", " ")}
                <select
                  value={importMapping[column] ?? ""}
                  required={column === "email"}
                  onChange={(event) => {
                    setImportMapping((current) => {
                      const next = { ...current };
                      if (event.target.value) next[column] = event.target.value;
                      else delete next[column];
                      return next;
                    });
                    setImportValidation(null);
                  }}
                >
                  <option value="">Not mapped</option>
                  {importHeaders.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <button
            className="button primary"
            disabled={!importMapping.email || validateImport.isPending}
            onClick={() => validateImport.mutate()}
          >
            {validateImport.isPending ? "Validating…" : "3. Validate mapped rows"}
          </button>
          {validateImport.error ? (
            <p className="form-error">{validateImport.error.message}</p>
          ) : null}
        </section>
      ) : null}
      {importValidation ? (
        <section className="panel import-panel">
          <div>
            <span className="eyebrow">Validation summary</span>
            <h2>4. Confirm and apply</h2>
            <p>
              {importValidation.valid} valid · {importValidation.invalid} invalid ·{" "}
              {importValidation.duplicates} duplicates · {importValidation.suppressed} suppressed
            </p>
          </div>
          {importValidation.preview.length ? (
            <DataTable headers={["Email", "Name", "Company"]}>
              {importValidation.preview.map((row, index) => (
                <tr key={`${row.email}-${index}`}>
                  <td>{row.email}</td>
                  <td>{row.name || "—"}</td>
                  <td>{row.company || "—"}</td>
                </tr>
              ))}
            </DataTable>
          ) : null}
          {Object.values(importValidation.unknownReferences).some((values) => values.length) ? (
            <label className="check-row">
              <input
                type="checkbox"
                checked={confirmUnknownReferences}
                onChange={(event) => setConfirmUnknownReferences(event.target.checked)}
              />
              <span>
                <strong>Create unknown reference values</strong>
                <small>
                  Tags: {importValidation.unknownReferences.tags.join(", ") || "none"}; markets:{" "}
                  {importValidation.unknownReferences.markets.join(", ") || "none"}; interests:{" "}
                  {importValidation.unknownReferences.propertyInterests.join(", ") || "none"}.
                </small>
              </span>
            </label>
          ) : null}
          <button
            className="button primary"
            disabled={
              applyImport.isPending ||
              (Object.values(importValidation.unknownReferences).some((values) => values.length) &&
                !confirmUnknownReferences)
            }
            onClick={() => applyImport.mutate()}
          >
            {applyImport.isPending ? "Queueing…" : "Apply import"}
          </button>
          {applyImport.error ? <p className="form-error">{applyImport.error.message}</p> : null}
        </section>
      ) : null}
      {importResult ? <p className="success-copy">{importResult}</p> : null}
      {importStatus.data &&
      !["UPLOADED", "READY", "PROCESSING"].includes(importStatus.data.status) ? (
        <section className="panel">
          <h2>Import {importStatus.data.status.toLowerCase()}</h2>
          <p>
            {importStatus.data.createdCount} created · {importStatus.data.updatedCount} updated ·{" "}
            {importStatus.data.skippedCount} skipped · {importStatus.data.invalidCount} invalid ·{" "}
            {importStatus.data.suppressedCount} suppressed
          </p>
          {importStatus.data.errorReportUrl ? (
            <a className="button secondary" href={`/api/v2/contact-imports/${importId}/errors.csv`}>
              Download error report
            </a>
          ) : null}
        </section>
      ) : null}
      {contactAction.error ? <p className="form-error">{contactAction.error.message}</p> : null}
    </Page>
  );
}

function DataTable({ headers, children }: PropsWithChildren<{ headers: string[] }>) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

type AudienceEstimate = {
  matched: number;
  eligible: number;
  suppressed: number;
  unknownPermission: number;
  invalid: number;
  sample: Array<{ id: string; email: string; displayName?: string }>;
};
function Audiences() {
  const client = useQueryClient();
  const [requireKnown, setRequireKnown] = useState(true);
  const [contactType, setContactType] = useState("");
  const [sourceType, setSourceType] = useState("");
  const [permissionBasis, setPermissionBasis] = useState("");
  const [tagId, setTagId] = useState("");
  const [allTagId, setAllTagId] = useState("");
  const [excludeTagId, setExcludeTagId] = useState("");
  const [marketId, setMarketId] = useState("");
  const [interestId, setInterestId] = useState("");
  const [engagedDays, setEngagedDays] = useState("");
  const [createdAfter, setCreatedAfter] = useState("");
  const [excludePreviouslySent, setExcludePreviouslySent] = useState(false);
  const [includeContactIds, setIncludeContactIds] = useState("");
  const [excludeContactIds, setExcludeContactIds] = useState("");
  const [audienceName, setAudienceName] = useState("");
  const reference = useQuery({
    queryKey: ["audience-reference"],
    queryFn: async () => {
      const [tags, markets, interests] = await Promise.all([
        api<ListResponse<{ id: string; name: string }>>("/api/v2/tags"),
        api<ListResponse<{ id: string; name: string }>>("/api/v2/markets"),
        api<ListResponse<{ id: string; name: string }>>("/api/v2/property-interests"),
      ]);
      return { tags: tags.items, markets: markets.items, interests: interests.items };
    },
  });
  const filter = () => ({
    requireKnownPermissionBasis: requireKnown,
    ...(contactType ? { contactTypes: [contactType] } : {}),
    ...(sourceType ? { sourceTypes: [sourceType] } : {}),
    ...(permissionBasis ? { permissionBases: [permissionBasis] } : {}),
    ...(tagId ? { tagIdsAny: [tagId] } : {}),
    ...(allTagId ? { tagIdsAll: [allTagId] } : {}),
    ...(excludeTagId ? { excludeTagIds: [excludeTagId] } : {}),
    ...(marketId ? { marketIdsAny: [marketId] } : {}),
    ...(interestId ? { propertyInterestIdsAny: [interestId] } : {}),
    ...(engagedDays ? { engagedWithinDays: Number(engagedDays) } : {}),
    ...(createdAfter ? { createdAfter: new Date(createdAfter).toISOString() } : {}),
    ...(includeContactIds.trim()
      ? {
          includeContactIds: includeContactIds
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        }
      : {}),
    ...(excludeContactIds.trim()
      ? {
          excludeContactIds: excludeContactIds
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        }
      : {}),
    ...(excludePreviouslySent ? { excludePreviouslySentListing: true } : {}),
  });
  const estimate = useMutation({
    mutationFn: () =>
      api<AudienceEstimate>("/api/v2/audiences/estimate", {
        method: "POST",
        body: JSON.stringify(filter()),
      }),
  });
  useEffect(() => {
    const timeout = window.setTimeout(() => estimate.mutate(), 400);
    return () => window.clearTimeout(timeout);
  }, [
    requireKnown,
    contactType,
    sourceType,
    permissionBasis,
    tagId,
    allTagId,
    excludeTagId,
    marketId,
    interestId,
    engagedDays,
    createdAfter,
    includeContactIds,
    excludeContactIds,
    excludePreviouslySent,
  ]);
  const saved = useQuery({
    queryKey: ["audiences"],
    queryFn: () =>
      api<
        ListResponse<{
          id: string;
          name: string;
          description?: string;
          lastEstimatedCount?: number;
        }>
      >("/api/v2/audiences"),
  });
  const save = useMutation({
    mutationFn: () =>
      api("/api/v2/audiences", {
        method: "POST",
        body: JSON.stringify({
          name: audienceName,
          description: `Validated audience · ${estimate.data?.eligible ?? 0} currently eligible`,
          filter: filter(),
        }),
      }),
    onSuccess: () => {
      setAudienceName("");
      void client.invalidateQueries({ queryKey: ["audiences"] });
    },
  });
  const savedAction = useMutation({
    mutationFn: async (input: {
      id: string;
      name: string;
      action: "rename" | "duplicate" | "update" | "delete";
    }) => {
      if (input.action === "duplicate")
        return api(`/api/v2/audiences/${input.id}/duplicate`, {
          method: "POST",
          body: JSON.stringify({}),
        });
      if (input.action === "delete")
        return api(`/api/v2/audiences/${input.id}`, { method: "DELETE" });
      if (input.action === "update")
        return api(`/api/v2/audiences/${input.id}`, {
          method: "PATCH",
          body: JSON.stringify({ filter: filter() }),
        });
      const name = window.prompt("Audience name", input.name)?.trim();
      if (!name) return;
      return api(`/api/v2/audiences/${input.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: ["audiences"] }),
  });
  return (
    <Page
      eyebrow="Targeting"
      title="Audiences"
      description="Combine relationship evidence with structured market and property interest signals."
    >
      <section className="audience-builder">
        <article className="panel">
          <span className="eyebrow">Filter logic</span>
          <h2>Audience workbench</h2>
          <label className="check-row">
            <input
              type="checkbox"
              checked={requireKnown}
              onChange={(event) => setRequireKnown(event.target.checked)}
            />
            <span>
              <strong>Require known permission basis</strong>
              <small>Excludes contacts whose relationship is not documented.</small>
            </span>
          </label>
          <div className="form-grid audience-fields">
            <label>
              Contact type
              <select value={contactType} onChange={(event) => setContactType(event.target.value)}>
                <option value="">Any type</option>
                {[
                  "BUYER",
                  "SELLER",
                  "INVESTOR",
                  "BROKER",
                  "TENANT",
                  "LANDLORD",
                  "DEVELOPER",
                  "LENDER",
                  "ATTORNEY",
                  "VENDOR",
                  "PAST_CLIENT",
                  "OTHER",
                ].map((value) => (
                  <option key={value} value={value}>
                    {value.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Any tag
              <select value={tagId} onChange={(event) => setTagId(event.target.value)}>
                <option value="">Any tag</option>
                {reference.data?.tags.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Required tag
              <select value={allTagId} onChange={(event) => setAllTagId(event.target.value)}>
                <option value="">No required tag</option>
                {reference.data?.tags.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Source
              <select value={sourceType} onChange={(event) => setSourceType(event.target.value)}>
                <option value="">Any source</option>
                {[
                  "PAST_CLIENT",
                  "OPEN_HOUSE",
                  "WEBSITE",
                  "BROKER_RELATIONSHIP",
                  "EVENT",
                  "CRM_IMPORT",
                  "MANUAL",
                  "REFERRAL",
                  "OTHER",
                ].map((value) => (
                  <option key={value} value={value}>
                    {value.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Permission basis
              <select
                value={permissionBasis}
                onChange={(event) => setPermissionBasis(event.target.value)}
              >
                <option value="">Any basis</option>
                {["OPT_IN", "EXISTING_RELATIONSHIP", "BUSINESS_CONTACT", "UNKNOWN"].map((value) => (
                  <option key={value} value={value}>
                    {value.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Exclude tag
              <select
                value={excludeTagId}
                onChange={(event) => setExcludeTagId(event.target.value)}
              >
                <option value="">No excluded tag</option>
                {reference.data?.tags.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Any market
              <select value={marketId} onChange={(event) => setMarketId(event.target.value)}>
                <option value="">Any market</option>
                {reference.data?.markets.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Property interest
              <select value={interestId} onChange={(event) => setInterestId(event.target.value)}>
                <option value="">Any interest</option>
                {reference.data?.interests.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Engaged within days
              <input
                type="number"
                min="1"
                max="3650"
                value={engagedDays}
                onChange={(event) => setEngagedDays(event.target.value)}
                placeholder="Any time"
              />
            </label>
            <label>
              Created after
              <input
                type="date"
                value={createdAfter}
                onChange={(event) => setCreatedAfter(event.target.value)}
              />
            </label>
            <label>
              Include contact IDs
              <textarea
                value={includeContactIds}
                onChange={(event) => setIncludeContactIds(event.target.value)}
                placeholder="Comma-separated UUIDs"
                rows={2}
              />
            </label>
            <label>
              Exclude contact IDs
              <textarea
                value={excludeContactIds}
                onChange={(event) => setExcludeContactIds(event.target.value)}
                placeholder="Comma-separated UUIDs"
                rows={2}
              />
            </label>
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={excludePreviouslySent}
              onChange={(event) => setExcludePreviouslySent(event.target.checked)}
            />
            Exclude contacts previously sent the same listing
          </label>
          <div className="toolbar">
            <button
              className="button primary"
              onClick={() => estimate.mutate()}
              disabled={estimate.isPending}
            >
              Estimate audience
            </button>
            <input
              aria-label="Audience name"
              placeholder="Audience name"
              value={audienceName}
              onChange={(event) => setAudienceName(event.target.value)}
            />
            <button
              className="button secondary"
              onClick={() => save.mutate()}
              disabled={!estimate.data || !audienceName.trim() || save.isPending}
            >
              Save audience
            </button>
          </div>
          {save.error ? <p className="form-error">{save.error.message}</p> : null}
        </article>
        <article className="panel estimate">
          <span className="eyebrow">Live estimate</span>
          {estimate.data ? (
            <>
              <strong>{estimate.data.eligible.toLocaleString()}</strong>
              <h2>eligible contacts</h2>
              <div className="estimate-grid">
                <span>
                  <b>{estimate.data.matched}</b> matched
                </span>
                <span>
                  <b>{estimate.data.suppressed}</b> suppressed
                </span>
                <span>
                  <b>{estimate.data.unknownPermission}</b> unknown permission
                </span>
                <span>
                  <b>{estimate.data.invalid}</b> invalid
                </span>
              </div>
              {estimate.data.sample.length ? (
                <div className="stack-list" aria-label="Eligible sample">
                  {estimate.data.sample.map((contact) => (
                    <div key={contact.id}>
                      <strong>{contact.displayName ?? "Unnamed contact"}</strong>
                      <span>{contact.email}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <EmptyState title="Estimate before saving">
              System eligibility is always appended; include rules never bypass suppression.
            </EmptyState>
          )}
        </article>
      </section>
      <section className="panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">Reusable</span>
            <h2>Saved audiences</h2>
          </div>
        </div>
        {saved.data?.items.length ? (
          <div className="stack-list">
            {saved.data.items.map((item) => (
              <div key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <span>{item.description ?? "No description"}</span>
                </div>
                <b>{item.lastEstimatedCount ?? "—"}</b>
                <div className="toolbar">
                  <button
                    className="text-button"
                    onClick={() =>
                      savedAction.mutate({ id: item.id, name: item.name, action: "rename" })
                    }
                  >
                    Rename
                  </button>
                  <button
                    className="text-button"
                    onClick={() =>
                      savedAction.mutate({ id: item.id, name: item.name, action: "duplicate" })
                    }
                  >
                    Duplicate
                  </button>
                  <button
                    className="text-button"
                    onClick={() =>
                      savedAction.mutate({ id: item.id, name: item.name, action: "update" })
                    }
                  >
                    Replace filter
                  </button>
                  <button
                    className="text-button danger"
                    onClick={() => {
                      if (window.confirm(`Delete audience ${item.name}?`))
                        savedAction.mutate({ id: item.id, name: item.name, action: "delete" });
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No saved audiences">
            Build an estimate, then save the validated filter.
          </EmptyState>
        )}
      </section>
      {savedAction.error ? <p className="form-error">{savedAction.error.message}</p> : null}
    </Page>
  );
}

type Campaign = {
  id: string;
  name: string;
  status: string;
  templateKey?: string;
  eligibleCount?: number;
  acceptedCount?: number;
  deliveredCount?: number;
  clickedCount?: number;
  bouncedCount?: number;
  complainedCount?: number;
  scheduledAt?: string;
  listing?: { title: string };
  senderProfile?: { name: string };
};
function Campaigns() {
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const campaigns = useQuery({
    queryKey: ["campaigns", status],
    queryFn: () =>
      api<ListResponse<Campaign>>(
        `/api/v2/campaigns?limit=100${status ? `&status=${status}` : ""}`
      ),
  });
  const [wizard, setWizard] = useState(false);
  if (selected) return <CampaignDetail id={selected} onClose={() => setSelected(null)} />;
  return (
    <Page
      eyebrow="Campaign operations"
      title="Campaigns"
      description="Every send is reviewed, snapshotted, paced, and auditable."
      action={
        <button className="button primary" onClick={() => setWizard(!wizard)}>
          {wizard ? "Close wizard" : "New campaign"}
        </button>
      }
    >
      {wizard ? (
        <CampaignWizard
          onCreated={() => {
            setWizard(false);
            void campaigns.refetch();
          }}
        />
      ) : null}
      <section className="panel">
        <div className="toolbar">
          <select
            aria-label="Filter campaign status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">All statuses</option>
            {[
              "DRAFT",
              "READY",
              "SCHEDULED",
              "QUEUED",
              "SENDING",
              "PAUSED",
              "COMPLETED",
              "CANCELLED",
              "FAILED",
              "ARCHIVED",
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </div>
        {campaigns.isLoading ? (
          <LoadingState />
        ) : campaigns.error ? (
          <ErrorState error={campaigns.error} />
        ) : campaigns.data!.items.length ? (
          <DataTable
            headers={[
              "Campaign",
              "Listing",
              "Status",
              "Eligible",
              "Accepted",
              "Delivered",
              "Clicked",
              "",
            ]}
          >
            {campaigns.data!.items.map((campaign) => (
              <tr key={campaign.id}>
                <td>
                  <strong>{campaign.name}</strong>
                  <small>{campaign.templateKey?.replaceAll("_", " ")}</small>
                </td>
                <td>{campaign.listing?.title ?? "—"}</td>
                <td>
                  <StatusPill value={campaign.status} />
                </td>
                <td>{campaign.eligibleCount ?? 0}</td>
                <td>{campaign.acceptedCount ?? 0}</td>
                <td>{campaign.deliveredCount ?? 0}</td>
                <td>{campaign.clickedCount ?? 0}</td>
                <td>
                  <button className="text-button" onClick={() => setSelected(campaign.id)}>
                    View detail
                  </button>
                </td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <EmptyState title="Create the first listing campaign">
            The wizard will lock listing, audience, sender, and content into a permanent snapshot.
          </EmptyState>
        )}
      </section>
    </Page>
  );
}

type CampaignDetailData = Campaign & {
  version: number;
  subject: string;
  preheader?: string;
  contentSnapshot?: Record<string, unknown>;
  audienceSnapshotSummary?: Record<string, unknown>;
  lastSuccessfulTestAt?: string;
  replyToAgent?: { displayName: string; email: string };
  senderProfile: { name: string; fromEmail: string };
};

function CampaignDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const client = useQueryClient();
  const [tab, setTab] = useState("overview");
  const [recipientSendState, setRecipientSendState] = useState("");
  const [recipientDeliveryState, setRecipientDeliveryState] = useState("");
  const [testEmail, setTestEmail] = useState("admin@homixny.com");
  const [scheduledAt, setScheduledAt] = useState("");
  const campaign = useQuery({
    queryKey: ["campaign", id],
    queryFn: () => api<CampaignDetailData>(`/api/v2/campaigns/${id}`),
  });
  const recipients = useQuery({
    queryKey: ["campaign-recipients", id, recipientSendState, recipientDeliveryState],
    queryFn: () =>
      api<
        ListResponse<{
          id: string;
          email: string;
          displayName?: string;
          company?: string;
          sendState: string;
          deliveryState: string;
          attemptCount: number;
          acceptedAt?: string;
          deliveredAt?: string;
          openedAt?: string;
          clickedAt?: string;
          lastErrorMessage?: string;
          suppressionReason?: string;
        }>
      >(
        `/api/v2/campaigns/${id}/recipients?limit=100${
          recipientSendState ? `&sendState=${recipientSendState}` : ""
        }${recipientDeliveryState ? `&deliveryState=${recipientDeliveryState}` : ""}`
      ),
    enabled: tab === "recipients",
  });
  const events = useQuery({
    queryKey: ["campaign-events", id],
    queryFn: () =>
      api<
        ListResponse<{
          id: string;
          eventType: string;
          providerEmailId?: string;
          eventCreatedAt: string;
          processingError?: string;
        }>
      >(`/api/v2/campaigns/${id}/events`),
    enabled: tab === "events",
  });
  const audits = useQuery({
    queryKey: ["campaign-audit", id],
    queryFn: () =>
      api<
        ListResponse<{
          id: string;
          action: string;
          entityId?: string;
          createdAt: string;
          actor?: { displayName?: string; email: string };
        }>
      >("/api/v2/audit-logs?limit=100"),
    enabled: tab === "audit",
  });
  const preview = useMutation({
    mutationFn: () =>
      api<{ html: string; text: string }>(`/api/v2/campaigns/${id}/preview`, {
        method: "POST",
        body: JSON.stringify({ firstName: "Preview" }),
      }),
  });
  const action = useMutation({
    mutationFn: (input: {
      name: "mark-ready" | "pause" | "resume" | "cancel" | "send-now" | "schedule";
      scheduledAt?: string;
    }) =>
      api(`/api/v2/campaigns/${id}/${input.name}`, {
        method: "POST",
        headers:
          input.name === "send-now" || input.name === "schedule"
            ? { "Idempotency-Key": crypto.randomUUID() }
            : undefined,
        body: JSON.stringify({
          version: campaign.data?.version ?? 1,
          scheduledAt: input.scheduledAt,
        }),
      }),
    onSuccess: () => {
      void campaign.refetch();
      void client.invalidateQueries({ queryKey: ["campaigns"] });
    },
  });
  const duplicate = useMutation({
    mutationFn: () =>
      api<Campaign>(`/api/v2/campaigns/${id}/duplicate`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["campaigns"] });
      onClose();
    },
  });
  const testSend = useMutation({
    mutationFn: () =>
      api(`/api/v2/campaigns/${id}/test-send`, {
        method: "POST",
        body: JSON.stringify({ email: testEmail, version: campaign.data?.version ?? 1 }),
      }),
    onSuccess: () => void campaign.refetch(),
  });
  if (campaign.isLoading)
    return (
      <Page
        eyebrow="Campaign"
        title="Loading detail"
        description="Retrieving frozen delivery state."
      >
        <LoadingState />
      </Page>
    );
  if (campaign.error || !campaign.data)
    return (
      <Page eyebrow="Campaign" title="Unable to load" description="Campaign detail is unavailable.">
        <ErrorState error={campaign.error ?? new Error("Campaign not found")} />
      </Page>
    );
  const item = campaign.data;
  const sendMessage = `Send ${item.name} from ${item.senderProfile.name} for ${item.listing?.title ?? "the selected listing"}. The server will freeze the audience, enforce suppression, and reserve daily quota.`;
  const canSend = item.status === "READY";
  const canCancel = ["READY", "SCHEDULED", "QUEUED", "SENDING", "PAUSED"].includes(item.status);
  return (
    <Page
      eyebrow="Campaign detail"
      title={item.name}
      description={`${item.senderProfile.fromEmail} · ${item.listing?.title ?? "No listing"}`}
      action={
        <button className="button secondary" onClick={onClose}>
          Back to campaigns
        </button>
      }
    >
      <section className="detail-hero panel">
        <div>
          <StatusPill value={item.status} />
          <h2>{item.subject}</h2>
          <p>{item.preheader ?? "No preheader"}</p>
        </div>
        <div className="detail-actions">
          <button className="button secondary" onClick={() => preview.mutate()}>
            Preview
          </button>
          <button className="button secondary" onClick={() => duplicate.mutate()}>
            Duplicate
          </button>
          {item.status === "DRAFT" ? (
            <button
              className="button secondary"
              onClick={() => action.mutate({ name: "mark-ready" })}
            >
              Mark ready
            </button>
          ) : null}
          {item.status === "SENDING" ? (
            <button className="button secondary" onClick={() => action.mutate({ name: "pause" })}>
              Pause
            </button>
          ) : null}
          {item.status === "PAUSED" ? (
            <button className="button secondary" onClick={() => action.mutate({ name: "resume" })}>
              Resume
            </button>
          ) : null}
          {canCancel ? (
            <button
              className="button secondary"
              disabled={action.isPending}
              onClick={() => {
                if (window.confirm(`Cancel ${item.name}? Unsent recipients will be released.`))
                  action.mutate({ name: "cancel" });
              }}
            >
              Cancel
            </button>
          ) : null}
          {canSend ? (
            <div className="schedule-control">
              <input
                type="datetime-local"
                aria-label="Schedule campaign"
                value={scheduledAt}
                min={new Date().toISOString().slice(0, 16)}
                onChange={(event) => setScheduledAt(event.target.value)}
              />
              <button
                className="button secondary"
                disabled={!scheduledAt || action.isPending}
                onClick={() =>
                  action.mutate({
                    name: "schedule",
                    scheduledAt: new Date(scheduledAt).toISOString(),
                  })
                }
              >
                Schedule
              </button>
            </div>
          ) : null}
          <button
            className="button primary"
            disabled={!canSend || action.isPending}
            title={canSend ? sendMessage : "Campaign must be READY before recipient snapshot."}
            onClick={() => {
              if (window.confirm(sendMessage)) action.mutate({ name: "send-now" });
            }}
          >
            Snapshot & send
          </button>
        </div>
        <div className="test-send-row">
          <input
            type="email"
            value={testEmail}
            onChange={(event) => setTestEmail(event.target.value)}
            aria-label="Test recipient"
          />
          <button className="text-button" onClick={() => testSend.mutate()}>
            Send allowlisted test
          </button>
          <span>
            {item.lastSuccessfulTestAt
              ? `Tested ${formatEt(item.lastSuccessfulTestAt)}`
              : "Current version not tested"}
          </span>
        </div>
        {action.error || testSend.error || duplicate.error ? (
          <p className="form-error">
            {(action.error ?? testSend.error ?? duplicate.error)?.message}
          </p>
        ) : null}
      </section>
      <div className="tabs">
        {["overview", "recipients", "events", "content", "audit"].map((value) => (
          <button
            key={value}
            className={tab === value ? "active" : ""}
            onClick={() => setTab(value)}
          >
            {value.replace(/^./, (letter) => letter.toUpperCase())}
          </button>
        ))}
      </div>
      {tab === "overview" ? (
        <section className="metrics">
          <Metric label="Eligible" value={item.eligibleCount ?? 0} note="Frozen recipients" />
          <Metric label="Accepted" value={item.acceptedCount ?? 0} note="Provider accepted" />
          <Metric label="Delivered" value={item.deliveredCount ?? 0} note="Webhook confirmed" />
          <Metric label="Clicked" value={item.clickedCount ?? 0} note="Unique recipients" />
        </section>
      ) : null}
      {tab === "recipients" ? (
        <section className="panel">
          <div className="toolbar">
            <select
              aria-label="Recipient send state"
              value={recipientSendState}
              onChange={(event) => setRecipientSendState(event.target.value)}
            >
              <option value="">All send states</option>
              {[
                "PENDING",
                "RESERVED",
                "SENDING",
                "ACCEPTED",
                "TEMPORARY_FAILED",
                "PERMANENT_FAILED",
                "SUPPRESSED",
                "CANCELLED",
                "MANUAL_REVIEW",
              ].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
            <select
              aria-label="Recipient delivery state"
              value={recipientDeliveryState}
              onChange={(event) => setRecipientDeliveryState(event.target.value)}
            >
              <option value="">All delivery states</option>
              {["UNKNOWN", "DELIVERED", "BOUNCED", "COMPLAINED", "PROVIDER_SUPPRESSED"].map(
                (value) => (
                  <option key={value}>{value}</option>
                )
              )}
            </select>
            <a
              className="button secondary"
              href={`/api/v2/campaigns/${id}/export.csv?${new URLSearchParams({
                ...(recipientSendState ? { sendState: recipientSendState } : {}),
                ...(recipientDeliveryState ? { deliveryState: recipientDeliveryState } : {}),
              })}`}
            >
              Export filtered CSV
            </a>
          </div>
          {recipients.isLoading ? (
            <LoadingState />
          ) : (
            <DataTable
              headers={[
                "Recipient",
                "Send",
                "Delivery",
                "Accepted",
                "Delivered",
                "Opened",
                "Clicked",
                "Attempts",
                "Last error",
              ]}
            >
              {recipients.data?.items.map((recipient) => (
                <tr key={recipient.id}>
                  <td>
                    <strong>{recipient.displayName ?? recipient.email}</strong>
                    <small>{recipient.company ?? recipient.email}</small>
                  </td>
                  <td>
                    <StatusPill value={recipient.sendState} />
                  </td>
                  <td>
                    <StatusPill value={recipient.deliveryState} />
                  </td>
                  <td>{formatEt(recipient.acceptedAt)}</td>
                  <td>{formatEt(recipient.deliveredAt)}</td>
                  <td>{formatEt(recipient.openedAt)}</td>
                  <td>{formatEt(recipient.clickedAt)}</td>
                  <td>{recipient.attemptCount}</td>
                  <td>{recipient.lastErrorMessage ?? recipient.suppressionReason ?? "—"}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </section>
      ) : null}
      {tab === "events" ? (
        <section className="panel stack-list">
          {events.data?.items.map((event) => (
            <div key={event.id}>
              <div>
                <strong>{event.eventType}</strong>
                <span>{event.providerEmailId ?? "Unmatched provider event"}</span>
              </div>
              <span>{formatEt(event.eventCreatedAt)}</span>
            </div>
          )) ?? <LoadingState />}
        </section>
      ) : null}
      {tab === "content" ? (
        <section className="panel content-snapshot">
          {preview.data ? (
            <iframe title="Campaign preview" sandbox="" srcDoc={preview.data.html} />
          ) : null}
          <pre>
            {JSON.stringify(
              item.contentSnapshot ?? { state: "Snapshot created at send time" },
              null,
              2
            )}
          </pre>
        </section>
      ) : null}
      {tab === "audit" ? (
        <section className="panel stack-list">
          {audits.data?.items
            .filter((entry) => entry.entityId === id)
            .map((entry) => (
              <div key={entry.id}>
                <div>
                  <strong>{entry.action}</strong>
                  <span>{entry.actor?.displayName ?? entry.actor?.email ?? "System"}</span>
                </div>
                <span>{formatEt(entry.createdAt)}</span>
              </div>
            )) ?? <LoadingState />}
        </section>
      ) : null}
    </Page>
  );
}

function CampaignWizard({ onCreated }: { onCreated: () => void }) {
  const [step, setStep] = useState(1);
  const [introHtml, setIntroHtml] = useState(
    "<p>I wanted to share this new opportunity with you.</p>"
  );
  const [form, setForm] = useState({
    name: "",
    listingId: "",
    senderProfileId: "",
    replyToAgentId: "",
    savedAudienceId: "",
    templateKey: "LISTING_BRANDED",
    subject: "",
    ctaLabel: "View Listing",
    ctaUrl: "",
  });
  const listings = useQuery({
    queryKey: ["listings-options"],
    queryFn: () => api<ListResponse<Listing>>("/api/v2/listings?limit=100"),
  });
  const senders = useQuery({
    queryKey: ["sender-options"],
    queryFn: () =>
      api<
        ListResponse<{ id: string; name: string; verificationStatus: string; fromEmail: string }>
      >("/api/v2/sender-profiles"),
  });
  const agents = useQuery({
    queryKey: ["agent-options"],
    queryFn: () =>
      api<ListResponse<{ id: string; displayName: string; email: string }>>("/api/v2/agents"),
  });
  const audiences = useQuery({
    queryKey: ["campaign-audience-options"],
    queryFn: () =>
      api<ListResponse<{ id: string; name: string; filter: Record<string, unknown> }>>(
        "/api/v2/audiences"
      ),
  });
  const create = useMutation({
    mutationFn: () =>
      api<Campaign>("/api/v2/campaigns", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          replyToAgentId: form.replyToAgentId || null,
          ctaUrl: form.ctaUrl || null,
          introHtml,
          savedAudienceId: form.savedAudienceId || null,
          audienceFilter: audiences.data?.items.find((item) => item.id === form.savedAudienceId)
            ?.filter ?? {
            requireKnownPermissionBasis: true,
          },
          timezone: "America/New_York",
        }),
      }),
    onSuccess: onCreated,
  });
  const fields = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));
  return (
    <section className="wizard panel">
      <div className="wizard-steps">
        {["Listing", "Audience", "Sender", "Content", "Review"].map((label, index) => (
          <button
            key={label}
            className={step === index + 1 ? "active" : step > index + 1 ? "done" : ""}
            onClick={() => setStep(index + 1)}
          >
            <span>{index + 1}</span>
            {label}
          </button>
        ))}
      </div>
      <div className="wizard-body">
        {step === 1 ? (
          <>
            <span className="eyebrow">Step 1</span>
            <h2>Choose the property story</h2>
            <label>
              Campaign name
              <input value={form.name} onChange={(event) => fields({ name: event.target.value })} />
            </label>
            <label>
              Active listing
              <select
                value={form.listingId}
                onChange={(event) => fields({ listingId: event.target.value })}
              >
                <option value="">Select a listing</option>
                {listings.data?.items
                  .filter((item) => item.status === "ACTIVE")
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
              </select>
            </label>
          </>
        ) : null}
        {step === 2 ? (
          <>
            <span className="eyebrow">Step 2</span>
            <h2>Define the audience</h2>
            <label>
              Saved audience
              <select
                value={form.savedAudienceId}
                onChange={(event) => fields({ savedAudienceId: event.target.value })}
              >
                <option value="">All contacts with known permission</option>
                {audiences.data?.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="notice">
              <strong>Known permission required</strong>
              <span>
                The initial wizard applies the saved safe default. Suppressions and archived
                contacts are excluded again at send time.
              </span>
            </div>
          </>
        ) : null}
        {step === 3 ? (
          <>
            <span className="eyebrow">Step 3</span>
            <h2>Set sender identity</h2>
            <label>
              Verified sender
              <select
                value={form.senderProfileId}
                onChange={(event) => fields({ senderProfileId: event.target.value })}
              >
                <option value="">Select sender</option>
                {senders.data?.items.map((item) => (
                  <option
                    key={item.id}
                    value={item.id}
                    disabled={item.verificationStatus !== "VERIFIED"}
                  >
                    {item.name} · {item.fromEmail} · {item.verificationStatus}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Reply-To agent
              <select
                value={form.replyToAgentId}
                onChange={(event) => fields({ replyToAgentId: event.target.value })}
              >
                <option value="">Use sender fallback</option>
                {agents.data?.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName} · {item.email}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
        {step === 4 ? (
          <>
            <span className="eyebrow">Step 4</span>
            <h2>Compose the message</h2>
            <label>
              Template
              <select
                value={form.templateKey}
                onChange={(event) => fields({ templateKey: event.target.value })}
              >
                <option value="LISTING_BRANDED">Listing branded</option>
                <option value="BROKER_PERSONAL">Broker personal</option>
              </select>
            </label>
            <label>
              Subject
              <input
                value={form.subject}
                maxLength={150}
                onChange={(event) => fields({ subject: event.target.value })}
              />
            </label>
            <label>
              Introduction
              <RichTextEditor value={introHtml} onChange={setIntroHtml} />
            </label>
            <div className="two-col">
              <label>
                CTA label
                <input
                  value={form.ctaLabel}
                  onChange={(event) => fields({ ctaLabel: event.target.value })}
                />
              </label>
              <label>
                CTA URL
                <input
                  type="url"
                  value={form.ctaUrl}
                  onChange={(event) => fields({ ctaUrl: event.target.value })}
                  placeholder="https://…"
                />
              </label>
            </div>
          </>
        ) : null}
        {step === 5 ? (
          <>
            <span className="eyebrow">Step 5</span>
            <h2>Review the locked inputs</h2>
            <div className="review-grid">
              <span>
                Campaign<b>{form.name || "Missing"}</b>
              </span>
              <span>
                Listing
                <b>
                  {listings.data?.items.find((item) => item.id === form.listingId)?.title ??
                    "Missing"}
                </b>
              </span>
              <span>
                Sender
                <b>
                  {senders.data?.items.find((item) => item.id === form.senderProfileId)?.name ??
                    "Missing"}
                </b>
              </span>
              <span>
                Template<b>{form.templateKey.replaceAll("_", " ")}</b>
              </span>
            </div>
            <div className="notice warning">
              <strong>This creates a draft—not a live send.</strong>
              <span>
                Preview and a successful allowlisted test are still required before the server
                permits scheduling.
              </span>
            </div>
            {create.error ? <p className="form-error">{create.error.message}</p> : null}
            <button
              className="button primary"
              onClick={() => create.mutate()}
              disabled={create.isPending}
            >
              Create campaign draft
            </button>
          </>
        ) : null}
      </div>
      <footer>
        <button
          className="button secondary"
          onClick={() => setStep(Math.max(1, step - 1))}
          disabled={step === 1}
        >
          Back
        </button>
        {step < 5 ? (
          <button className="button primary" onClick={() => setStep(step + 1)}>
            Continue
          </button>
        ) : null}
      </footer>
    </section>
  );
}

function Analytics() {
  const campaigns = useQuery({
    queryKey: ["campaigns-analytics"],
    queryFn: () => api<ListResponse<Campaign>>("/api/v2/campaigns?limit=100"),
  });
  return (
    <Page
      eyebrow="Signal, not vanity"
      title="Analytics"
      description="Unique engagement, delivery, bounce, and complaint rates use explicit denominators."
    >
      {campaigns.isLoading ? (
        <LoadingState />
      ) : campaigns.error ? (
        <ErrorState error={campaigns.error} />
      ) : (
        <section className="panel">
          <DataTable
            headers={[
              "Campaign",
              "Accepted",
              "Delivery rate",
              "Open rate · estimated",
              "Click rate",
              "Bounce",
              "Complaint",
            ]}
          >
            {campaigns.data!.items.map((item) => {
              const accepted = item.acceptedCount ?? 0;
              const delivered = item.deliveredCount ?? 0;
              return (
                <tr key={item.id}>
                  <td>
                    <strong>{item.name}</strong>
                  </td>
                  <td>{accepted}</td>
                  <td>{accepted ? `${Math.round((delivered / accepted) * 100)}%` : "—"}</td>
                  <td>See detail</td>
                  <td>
                    {delivered
                      ? `${Math.round(((item.clickedCount ?? 0) / delivered) * 100)}%`
                      : "—"}
                  </td>
                  <td>{item.bouncedCount ?? 0}</td>
                  <td>{item.complainedCount ?? 0}</td>
                </tr>
              );
            })}
          </DataTable>
        </section>
      )}
    </Page>
  );
}

function Settings({ user }: { user: Me["user"] }) {
  const client = useQueryClient();
  const [settingsTab, setSettingsTab] = useState<
    "tags" | "markets" | "property-interests" | "users" | "audit-logs" | "suppressions"
  >("tags");
  const readiness = useQuery({
    queryKey: ["readiness"],
    queryFn: () => api<Record<string, unknown>>("/api/v2/system/readiness"),
    enabled: user.role === "ADMIN",
  });
  const agents = useQuery({
    queryKey: ["agents"],
    queryFn: () =>
      api<ListResponse<{ id: string; displayName: string; email: string; isActive: boolean }>>(
        "/api/v2/agents"
      ),
  });
  const senders = useQuery({
    queryKey: ["senders"],
    queryFn: () =>
      api<
        ListResponse<{
          id: string;
          name: string;
          fromEmail: string;
          verificationStatus: string;
          dailyLimit: number;
          isDefault: boolean;
        }>
      >("/api/v2/sender-profiles"),
  });
  const createAgent = useMutation({
    mutationFn: (form: FormData) =>
      api("/api/v2/agents", {
        method: "POST",
        body: JSON.stringify({
          firstName: form.get("firstName"),
          lastName: form.get("lastName"),
          displayName: `${String(form.get("firstName"))} ${String(form.get("lastName"))}`,
          email: form.get("email"),
          phone: form.get("phone") || null,
          title: form.get("title") || null,
        }),
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["agents"] }),
  });
  const createSender = useMutation({
    mutationFn: (form: FormData) =>
      api("/api/v2/sender-profiles", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          fromName: form.get("fromName"),
          fromEmail: form.get("fromEmail"),
          domain: form.get("domain"),
          fixedReplyToEmail: form.get("replyTo") || null,
          dailyLimit: Number(form.get("dailyLimit")),
          batchSize: Number(form.get("batchSize")),
          minBatchIntervalSeconds: Number(form.get("interval")),
          timezone: "America/New_York",
          sendWindowStart: "08:00",
          sendWindowEnd: "18:00",
          allowedWeekdays: [1, 2, 3, 4, 5],
          warmupEnabled: false,
          isDefault: form.get("isDefault") === "on",
        }),
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["senders"] }),
  });
  const sendingControl = useMutation({
    mutationFn: (input: {
      action: "pause" | "resume";
      reason: string;
      recoveryReconciled: boolean;
    }) =>
      api(`/api/v2/system/sending/${input.action}`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => void readiness.refetch(),
  });
  const changeSending = (action: "pause" | "resume") => {
    const reason = window.prompt(
      action === "pause"
        ? "Why is all delivery being paused?"
        : "Describe the review completed before resuming delivery:"
    );
    if (!reason?.trim()) return;
    sendingControl.mutate({
      action,
      reason: reason.trim(),
      recoveryReconciled:
        action === "resume" &&
        window.confirm(
          "Confirm that restored/queued database state has been reconciled and will not duplicate prior sends."
        ),
    });
  };
  return (
    <Page
      eyebrow="Controls"
      title="Settings"
      description="Identity, reference data, sender readiness, and operational safety live here."
    >
      <section className="settings-grid">
        <article className="panel">
          <span className="eyebrow">Sender profiles</span>
          <h2>Stable identity</h2>
          {senders.data?.items.length ? (
            <div className="stack-list">
              {senders.data.items.map((sender) => (
                <div key={sender.id}>
                  <div>
                    <strong>
                      {sender.name}
                      {sender.isDefault ? " · Default" : ""}
                    </strong>
                    <span>
                      {sender.fromEmail} · {sender.dailyLimit}/day
                    </span>
                  </div>
                  <StatusPill value={sender.verificationStatus} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No sender profile">
              Seed the default Homix Listings profile, then confirm DNS verification.
            </EmptyState>
          )}
          {user.role === "ADMIN" ? (
            <form
              className="inline-create"
              onSubmit={(event) => {
                event.preventDefault();
                createSender.mutate(new FormData(event.currentTarget));
                event.currentTarget.reset();
              }}
            >
              <h3>Add sender</h3>
              <input name="name" placeholder="Profile name" required />
              <input name="fromName" placeholder="From name" required />
              <input name="fromEmail" type="email" placeholder="listings@domain" required />
              <input name="domain" placeholder="domain.com" required />
              <input name="replyTo" type="email" placeholder="Reply-To fallback" />
              <div className="three-col">
                <input
                  name="dailyLimit"
                  type="number"
                  min="1"
                  defaultValue="500"
                  aria-label="Daily limit"
                />
                <input
                  name="batchSize"
                  type="number"
                  min="1"
                  max="100"
                  defaultValue="50"
                  aria-label="Batch size"
                />
                <input
                  name="interval"
                  type="number"
                  min="1"
                  defaultValue="60"
                  aria-label="Batch interval seconds"
                />
              </div>
              <label className="check-row">
                <input name="isDefault" type="checkbox" /> Default sender
              </label>
              <button className="text-button" disabled={createSender.isPending}>
                Create unverified sender
              </button>
            </form>
          ) : null}
        </article>
        <article className="panel">
          <span className="eyebrow">Agents</span>
          <h2>Reply-To identities</h2>
          {agents.data?.items.length ? (
            <div className="stack-list">
              {agents.data.items.map((agent) => (
                <div key={agent.id}>
                  <div>
                    <strong>{agent.displayName}</strong>
                    <span>{agent.email}</span>
                  </div>
                  <StatusPill value={agent.isActive ? "ACTIVE" : "INACTIVE"} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="Add an agent first">
              Agents own listings and receive replies without changing the stable From address.
            </EmptyState>
          )}
          {user.role === "ADMIN" ? (
            <form
              className="inline-create"
              onSubmit={(event) => {
                event.preventDefault();
                createAgent.mutate(new FormData(event.currentTarget));
                event.currentTarget.reset();
              }}
            >
              <h3>Add agent</h3>
              <div className="two-col">
                <input name="firstName" placeholder="First name" required />
                <input name="lastName" placeholder="Last name" required />
              </div>
              <input name="email" type="email" placeholder="Email" required />
              <div className="two-col">
                <input name="phone" placeholder="Phone" />
                <input name="title" placeholder="Title" />
              </div>
              <button className="text-button" disabled={createAgent.isPending}>
                Create agent
              </button>
            </form>
          ) : null}
        </article>
        <article className="panel readiness">
          <span className="eyebrow">System readiness</span>
          <h2>Live-send gates</h2>
          {user.role !== "ADMIN" ? (
            <p>Admin access is required.</p>
          ) : readiness.isLoading ? (
            <LoadingState />
          ) : readiness.error ? (
            <ErrorState error={readiness.error} />
          ) : (
            <dl>
              {Object.entries(readiness.data ?? {}).map(([key, value]) => (
                <div key={key}>
                  <dt>{key.replaceAll(/([A-Z])/g, " $1")}</dt>
                  <dd>{typeof value === "object" ? JSON.stringify(value) : String(value)}</dd>
                </div>
              ))}
            </dl>
          )}
          {user.role === "ADMIN" ? (
            <div className="toolbar">
              <button className="button secondary" onClick={() => changeSending("pause")}>
                Pause all sending
              </button>
              <button className="button primary" onClick={() => changeSending("resume")}>
                Resume after review
              </button>
            </div>
          ) : null}
        </article>
        <article className="panel">
          <span className="eyebrow">Reference data</span>
          <h2>Targeting vocabulary</h2>
          <div className="reference-links">
            <button onClick={() => setSettingsTab("tags")}>Tags</button>
            <button onClick={() => setSettingsTab("markets")}>Markets</button>
            <button onClick={() => setSettingsTab("property-interests")}>Property interests</button>
            <button onClick={() => setSettingsTab("users")}>Users & roles</button>
            <button onClick={() => setSettingsTab("audit-logs")}>Audit log</button>
            <button onClick={() => setSettingsTab("suppressions")}>Suppressions</button>
          </div>
        </article>
      </section>
      <SettingsResourcePanel tab={settingsTab} admin={user.role === "ADMIN"} />
    </Page>
  );
}

function SettingsResourcePanel({
  tab,
  admin,
}: {
  tab: "tags" | "markets" | "property-interests" | "users" | "audit-logs" | "suppressions";
  admin: boolean;
}) {
  const client = useQueryClient();
  const result = useQuery({
    queryKey: ["settings-resource", tab],
    queryFn: () =>
      api<
        ListResponse<{
          id: string;
          name?: string;
          email?: string;
          role?: string;
          action?: string;
          entityType?: string;
          reason?: string;
          emailNormalized?: string;
          createdAt?: string;
          suppressedAt?: string;
          isActive?: boolean;
        }>
      >(`/api/v2/${tab}?limit=100`),
    enabled: admin || !["users", "audit-logs", "suppressions"].includes(tab),
  });
  const createReference = useMutation({
    mutationFn: (name: string) =>
      api(`/api/v2/${tab}`, {
        method: "POST",
        body: JSON.stringify({
          name,
          ...(tab === "tags" ? { color: "#64748b" } : {}),
          ...(tab === "markets" ? { type: "CUSTOM" } : {}),
          ...(tab === "property-interests" ? { propertyType: null } : {}),
        }),
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["settings-resource", tab] }),
  });
  return (
    <section className="panel settings-resource">
      <div className="panel-head">
        <div>
          <span className="eyebrow">Administration</span>
          <h2>{tab.replaceAll("-", " ")}</h2>
        </div>
        {["tags", "markets", "property-interests"].includes(tab) ? (
          <form
            className="toolbar"
            onSubmit={(event) => {
              event.preventDefault();
              const input = event.currentTarget.elements.namedItem("name") as HTMLInputElement;
              createReference.mutate(input.value);
              event.currentTarget.reset();
            }}
          >
            <input name="name" placeholder={`New ${tab.replaceAll("-", " ")}`} required />
            <button className="button secondary">Add</button>
          </form>
        ) : null}
      </div>
      {!admin && ["users", "audit-logs", "suppressions"].includes(tab) ? (
        <p>Admin access is required for this dataset.</p>
      ) : result.isLoading ? (
        <LoadingState />
      ) : result.error ? (
        <ErrorState error={result.error} />
      ) : result.data?.items.length ? (
        <DataTable headers={["Name / action", "Detail", "State", "Time"]}>
          {result.data.items.map((item) => (
            <tr key={item.id}>
              <td>
                <strong>{item.name ?? item.action ?? item.email ?? item.emailNormalized}</strong>
              </td>
              <td>{item.entityType ?? item.reason ?? item.email ?? "—"}</td>
              <td>{item.role ?? (item.isActive === false ? "INACTIVE" : "ACTIVE")}</td>
              <td>{formatEt(item.createdAt ?? item.suppressedAt)}</td>
            </tr>
          ))}
        </DataTable>
      ) : (
        <EmptyState title={`No ${tab.replaceAll("-", " ")} found`}>
          Add or import records to populate this area.
        </EmptyState>
      )}
    </section>
  );
}
