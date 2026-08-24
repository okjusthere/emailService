import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Search, Upload } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import type { ListResponse } from "../app/types.js";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/ui/Feedback.js";
import { Page } from "../components/ui/Page.js";
import { api, formatEt } from "../lib/api.js";

type Contact = {
  id: string;
  email: string;
  displayName?: string | null;
  company?: string | null;
  contactType: string;
  sourceType: string;
  permissionBasis: string;
  lastSentAt?: string | null;
  suppressed?: boolean;
  suppressionReason?: string | null;
};
type Audience = {
  id: string;
  name: string;
  description?: string | null;
  lastEstimatedCount?: number | null;
  updatedAt: string;
};
type Suppression = { id: string; emailNormalized: string; reason: string; suppressedAt: string };

export function ContactsPage() {
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get("tab");
  const [tab, setTabState] = useState<"contacts" | "groups" | "imports" | "do-not-email">(
    requestedTab === "lists"
      ? "groups"
      : requestedTab === "imports"
        ? "imports"
        : requestedTab === "suppressed"
          ? "do-not-email"
          : "contacts"
  );
  const [search, setSearch] = useState("");
  const [showImport, setShowImport] = useState(false);
  function setTab(next: typeof tab) {
    setTabState(next);
    setParams(
      next === "contacts"
        ? {}
        : { tab: next === "groups" ? "lists" : next === "do-not-email" ? "suppressed" : next }
    );
  }
  const contacts = useQuery({
    queryKey: ["contacts-simple", search],
    queryFn: () =>
      api<ListResponse<Contact>>(`/api/v2/contacts?limit=100&search=${encodeURIComponent(search)}`),
    enabled: tab === "contacts",
  });
  const audiences = useQuery({
    queryKey: ["audiences-simple"],
    queryFn: () => api<ListResponse<Audience>>("/api/v2/audiences"),
    enabled: tab === "groups",
  });
  const suppressions = useQuery({
    queryKey: ["suppressions-simple"],
    queryFn: () => api<ListResponse<Suppression>>("/api/v2/suppressions?limit=100"),
    enabled: tab === "do-not-email",
  });
  const importCsv = useMutation({
    mutationFn: async (form: FormData) => {
      form.set("sourceType", "CRM_IMPORT");
      form.set("permissionBasis", "BUSINESS_CONTACT");
      form.set("sourceDetail", "Uploaded through Homix Marketing");
      const uploaded = await api<{ id: string }>("/api/v2/contact-imports/upload", {
        method: "POST",
        body: form,
      });
      await api(`/api/v2/contact-imports/${uploaded.id}/validate`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      return api(`/api/v2/contact-imports/${uploaded.id}/apply`, {
        method: "POST",
        body: JSON.stringify({ confirmCreateUnknownReferences: true }),
      });
    },
    onSuccess: () => {
      setShowImport(false);
      void client.invalidateQueries({ queryKey: ["contacts-simple"] });
    },
  });
  function submitImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    importCsv.mutate(new FormData(event.currentTarget));
  }
  return (
    <Page
      title="Contacts"
      description="People, reusable recipient groups, and do-not-email protections."
      action={
        <div className="detail-buttons">
          <button className="button primary" onClick={() => setShowImport(!showImport)}>
            <Upload size={16} /> Import CSV
          </button>
          <a className="button secondary" href="/api/v2/contacts/export">
            <Download size={16} /> Export
          </a>
        </div>
      }
    >
      {showImport || tab === "imports" ? (
        <form className="panel-simple import-card" onSubmit={submitImport}>
          <div>
            <h2>Import contacts</h2>
            <p>
              CSV must include an email column. Imported addresses use a business-contact permission
              basis and still pass all suppression checks.
            </p>
          </div>
          <input name="file" type="file" accept=".csv,text/csv" required />
          <button className="button primary" disabled={importCsv.isPending}>
            {importCsv.isPending ? "Importing…" : "Upload & import"}
          </button>
          {importCsv.error ? <p className="form-error">{importCsv.error.message}</p> : null}
        </form>
      ) : null}
      <div className="segmented" role="tablist">
        {(["contacts", "groups", "imports", "do-not-email"] as const).map((item) => (
          <button
            key={item}
            role="tab"
            aria-selected={tab === item}
            className={tab === item ? "active" : ""}
            onClick={() => setTab(item)}
          >
            {item === "do-not-email"
              ? "Suppressed"
              : item === "groups"
                ? "Lists & segments"
                : item === "contacts"
                  ? "All contacts"
                  : "Imports"}
          </button>
        ))}
      </div>
      {tab === "contacts" ? (
        <section className="panel-simple">
          <div className="table-toolbar">
            <label className="small-search">
              <Search size={16} />
              <span className="sr-only">Search contacts</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name or email"
              />
            </label>
            <span>{contacts.data?.total ?? 0} contacts</span>
          </div>
          {contacts.isLoading ? (
            <LoadingBlock />
          ) : contacts.error ? (
            <ErrorBlock error={contacts.error} />
          ) : contacts.data?.items.length ? (
            <div className="data-list">
              {contacts.data.items.map((contact) => (
                <div key={contact.id}>
                  <span>
                    <strong>{contact.displayName ?? contact.email}</strong>
                    <small>{contact.company ?? contact.email}</small>
                  </span>
                  <span>{contact.contactType.replaceAll("_", " ")}</span>
                  <span>
                    {contact.sourceType === "MLS_AGENT_MATCH"
                      ? "Property match"
                      : contact.sourceType.replaceAll("_", " ")}
                  </span>
                  <span>{contact.suppressed ? "Do not email" : formatEt(contact.lastSentAt)}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyBlock title="No contacts found">
              Contacts appear after importing recipient suggestions or a CSV.
            </EmptyBlock>
          )}
        </section>
      ) : null}
      {tab === "groups" ? (
        <section className="panel-simple">
          {audiences.isLoading ? (
            <LoadingBlock />
          ) : audiences.error ? (
            <ErrorBlock error={audiences.error} />
          ) : audiences.data?.items.length ? (
            <div className="data-list groups">
              {audiences.data.items.map((audience) => (
                <div key={audience.id}>
                  <span>
                    <strong>{audience.name}</strong>
                    <small>{audience.description ?? "Saved recipient group"}</small>
                  </span>
                  <strong>{(audience.lastEstimatedCount ?? 0).toLocaleString()}</strong>
                  <span>{formatEt(audience.updatedAt)}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyBlock title="No saved groups">
              Suggested recipients are saved here automatically.
            </EmptyBlock>
          )}
        </section>
      ) : null}
      {tab === "do-not-email" ? (
        <section className="panel-simple">
          <p>These addresses are automatically excluded from marketing emails.</p>
          {suppressions.isLoading ? (
            <LoadingBlock />
          ) : suppressions.error ? (
            <ErrorBlock error={suppressions.error} />
          ) : suppressions.data?.items.length ? (
            <div className="data-list suppressions">
              {suppressions.data.items.map((item) => (
                <div key={item.id}>
                  <strong>{item.emailNormalized}</strong>
                  <span>{item.reason.replaceAll("_", " ")}</span>
                  <span>{formatEt(item.suppressedAt)}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyBlock title="No suppressed addresses">
              Unsubscribes, complaints, and hard bounces will appear here.
            </EmptyBlock>
          )}
        </section>
      ) : null}
    </Page>
  );
}
