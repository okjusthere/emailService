import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ServerCog, ShieldCheck } from "lucide-react";
import type { ListResponse, User } from "../app/types.js";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/ui/Feedback.js";
import { Page } from "../components/ui/Page.js";
import { StatusBadge } from "../components/ui/StatusBadge.js";
import { api, formatEt } from "../lib/api.js";
import { useState, type FormEvent } from "react";

type Sender = {
  id: string;
  name: string;
  fromEmail: string;
  verificationStatus: string;
  isDefault: boolean;
  isActive: boolean;
  dailyLimit: number;
};
type Agent = {
  id: string;
  displayName: string;
  email: string;
  phone?: string | null;
  title?: string | null;
  isActive: boolean;
};
type Readiness = {
  database: string;
  migration: string | null;
  deliveryMode: string;
  companyAddressConfigured: boolean;
  defaultSenderVerified: boolean;
  globalSendPaused: boolean;
  recoveryGuard: unknown;
  deliverabilityAlert: unknown;
  workerHeartbeat: { at?: string } | null;
};

export function SettingsPage({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"general" | "sending" | "integrations" | "operations">(
    window.location.pathname.endsWith("/operations") && user.role === "ADMIN"
      ? "operations"
      : "general"
  );
  const settingTabs: Array<typeof tab> = [
    "general",
    "sending",
    "integrations",
    ...(user.role === "ADMIN" ? (["operations"] as const) : []),
  ];
  const senders = useQuery({
    queryKey: ["settings-senders"],
    queryFn: () => api<ListResponse<Sender>>("/api/v2/sender-profiles"),
  });
  const agents = useQuery({
    queryKey: ["settings-agents"],
    queryFn: () => api<ListResponse<Agent>>("/api/v2/agents"),
  });
  const readiness = useQuery({
    queryKey: ["readiness"],
    queryFn: () => api<Readiness>("/api/v2/system/readiness"),
    enabled: user.role === "ADMIN",
  });
  const reviews = useQuery({
    queryKey: ["manual-review"],
    queryFn: () =>
      api<ListResponse<{ id: string; campaign: { name: string }; recipients: unknown[] }>>(
        "/api/v2/operations/manual-review"
      ),
    enabled: user.role === "ADMIN",
  });
  const integrationStatus = useQuery({
    queryKey: ["integration-status"],
    queryFn: async () => {
      const [ai, oneKey] = await Promise.all([
        api<{ productionReady: boolean }>("/api/v2/ai/status"),
        user.role === "ADMIN"
          ? api<{ configured: boolean }>("/api/v2/onekey/status")
          : Promise.resolve({ configured: true }),
      ]);
      return { ai, oneKey };
    },
    enabled: tab === "integrations",
  });
  const sending = useMutation({
    mutationFn: (action: "pause" | "resume") =>
      api(`/api/v2/system/sending/${action}`, {
        method: "POST",
        body: JSON.stringify({
          reason:
            action === "pause"
              ? "Paused from simplified operations screen"
              : "Administrator reviewed delivery state before resuming",
          recoveryReconciled: action === "resume",
        }),
      }),
    onSuccess: () => void readiness.refetch(),
  });
  const createAgent = useMutation({
    mutationFn: (form: HTMLFormElement) => {
      const values = new FormData(form);
      const firstName = String(values.get("firstName") ?? "").trim();
      const lastName = String(values.get("lastName") ?? "").trim();
      return api<Agent>("/api/v2/agents", {
        method: "POST",
        body: JSON.stringify({
          firstName,
          lastName,
          displayName: `${firstName} ${lastName}`.trim(),
          email: String(values.get("email") ?? "").trim(),
          phone: String(values.get("phone") ?? "").trim() || null,
          title: String(values.get("title") ?? "").trim() || null,
          licenseNumber: String(values.get("licenseNumber") ?? "").trim() || null,
          headshotUrl: null,
          signatureHtml: null,
        }),
      });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["settings-agents"] }),
  });

  function submitAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    createAgent.mutate(form, {
      onSuccess: () => form.reset(),
    });
  }
  return (
    <Page title="Settings" description="Sending identity, reply-to agents, and operational health.">
      <div className="segmented" role="tablist" aria-label="Settings sections">
        {settingTabs.map((item) => (
          <button
            key={item}
            role="tab"
            aria-selected={tab === item}
            className={tab === item ? "active" : ""}
            onClick={() => setTab(item)}
          >
            {item.charAt(0).toUpperCase() + item.slice(1)}
          </button>
        ))}
      </div>
      {tab === "general" || tab === "sending" ? (
        <section className="settings-simple-grid">
          <article className="panel-simple">
            <span className="eyebrow">Sending identity</span>
            <h2>Verified senders</h2>
            {senders.isLoading ? (
              <LoadingBlock />
            ) : senders.error ? (
              <ErrorBlock error={senders.error} />
            ) : senders.data?.items.length ? (
              <div className="settings-list">
                {senders.data.items.map((sender) => (
                  <div key={sender.id}>
                    <span>
                      <strong>
                        {sender.name}
                        {sender.isDefault ? " · Default" : ""}
                      </strong>
                      <small>
                        {sender.fromEmail} · up to {sender.dailyLimit.toLocaleString()}/day
                      </small>
                    </span>
                    <StatusBadge value={sender.verificationStatus} />
                  </div>
                ))}
              </div>
            ) : (
              <EmptyBlock title="No sender configured">
                An administrator must add and verify a sending domain.
              </EmptyBlock>
            )}
          </article>
          <article className="panel-simple">
            <span className="eyebrow">Replies</span>
            <h2>Listing agents</h2>
            {agents.isLoading ? (
              <LoadingBlock />
            ) : agents.error ? (
              <ErrorBlock error={agents.error} />
            ) : agents.data?.items.length ? (
              <div className="settings-list">
                {agents.data.items.map((agent) => (
                  <div key={agent.id}>
                    <span>
                      <strong>{agent.displayName}</strong>
                      <small>{agent.email}</small>
                    </span>
                    <StatusBadge value={agent.isActive ? "ACTIVE" : "INACTIVE"} />
                  </div>
                ))}
              </div>
            ) : (
              <EmptyBlock title="No listing agents">
                Add an agent before importing a listing.
              </EmptyBlock>
            )}
            {user.role === "ADMIN" ? (
              <details className="settings-add-agent">
                <summary>Add listing agent</summary>
                <form onSubmit={submitAgent}>
                  <label>
                    First name
                    <input name="firstName" required />
                  </label>
                  <label>
                    Last name
                    <input name="lastName" required />
                  </label>
                  <label>
                    Email
                    <input name="email" type="email" required />
                  </label>
                  <label>
                    Phone
                    <input name="phone" type="tel" />
                  </label>
                  <label>
                    Title
                    <input name="title" placeholder="Licensed Real Estate Salesperson" />
                  </label>
                  <label>
                    License number
                    <input name="licenseNumber" />
                  </label>
                  <button className="button primary" disabled={createAgent.isPending}>
                    {createAgent.isPending ? "Adding…" : "Add agent"}
                  </button>
                  {createAgent.error ? <ErrorBlock error={createAgent.error} /> : null}
                </form>
              </details>
            ) : null}
          </article>
        </section>
      ) : null}
      {tab === "integrations" ? (
        <section className="settings-simple-grid">
          {integrationStatus.isLoading ? (
            <LoadingBlock />
          ) : integrationStatus.error ? (
            <ErrorBlock error={integrationStatus.error} />
          ) : (
            <>
              <article className="panel-simple health-card">
                <CheckCircle2
                  className={integrationStatus.data?.oneKey.configured ? "good" : "warning-icon"}
                />
                <div>
                  <h3>OneKey MLS</h3>
                  <p>
                    {integrationStatus.data?.oneKey.configured
                      ? "Connected"
                      : "Needs configuration"}
                  </p>
                </div>
              </article>
              <article className="panel-simple health-card">
                <CheckCircle2
                  className={integrationStatus.data?.ai.productionReady ? "good" : "warning-icon"}
                />
                <div>
                  <h3>AI writing</h3>
                  <p>
                    {integrationStatus.data?.ai.productionReady
                      ? "Connected"
                      : "Fallback draft available"}
                  </p>
                </div>
              </article>
              <article className="panel-simple health-card">
                <CheckCircle2
                  className={
                    senders.data?.items.some((item) => item.verificationStatus === "VERIFIED")
                      ? "good"
                      : "warning-icon"
                  }
                />
                <div>
                  <h3>Email delivery</h3>
                  <p>
                    {senders.data?.items.some((item) => item.verificationStatus === "VERIFIED")
                      ? "Connected"
                      : "Sender needs verification"}
                  </p>
                </div>
              </article>
              <article className="panel-simple health-card">
                <CheckCircle2 className="good" />
                <div>
                  <h3>Azure Storage</h3>
                  <p>Managed by the application</p>
                </div>
              </article>
            </>
          )}
        </section>
      ) : null}
      {user.role === "ADMIN" && tab === "operations" ? (
        <section className="operations-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Administrator only</span>
              <h2>Operations</h2>
            </div>
          </div>
          {readiness.isLoading ? (
            <LoadingBlock />
          ) : readiness.error ? (
            <ErrorBlock error={readiness.error} />
          ) : readiness.data ? (
            <div className="operations-grid">
              <article className="panel-simple health-card">
                <ServerCog />
                <div>
                  <h3>Application</h3>
                  <p>
                    Database {readiness.data.database} · migration{" "}
                    {readiness.data.migration ?? "unknown"}
                  </p>
                  <p>Worker heartbeat {formatEt(readiness.data.workerHeartbeat?.at)}</p>
                </div>
                <CheckCircle2 className="good" />
              </article>
              <article className="panel-simple health-card">
                <ShieldCheck />
                <div>
                  <h3>Sending safeguards</h3>
                  <p>
                    {readiness.data.defaultSenderVerified
                      ? "Sender verified"
                      : "Sender needs verification"}{" "}
                    ·{" "}
                    {readiness.data.companyAddressConfigured
                      ? "address configured"
                      : "address missing"}
                  </p>
                  <p>Delivery mode: {readiness.data.deliveryMode}</p>
                </div>
                {readiness.data.globalSendPaused ? (
                  <AlertTriangle className="warning-icon" />
                ) : (
                  <CheckCircle2 className="good" />
                )}
              </article>
              <article className="panel-simple operation-actions">
                <h3>
                  {readiness.data.globalSendPaused ? "Sending is paused" : "Sending is active"}
                </h3>
                <p>
                  Changing this affects every campaign. Campaign-level pause remains available on
                  each detail page.
                </p>
                <button
                  className={
                    readiness.data.globalSendPaused ? "button primary" : "button danger-button"
                  }
                  disabled={sending.isPending}
                  onClick={() => {
                    const action = readiness.data!.globalSendPaused ? "resume" : "pause";
                    if (window.confirm(`${action === "resume" ? "Resume" : "Pause"} all sending?`))
                      sending.mutate(action);
                  }}
                >
                  {readiness.data.globalSendPaused ? "Resume all sending" : "Pause all sending"}
                </button>
              </article>
              <article className="panel-simple">
                <h3>Manual review</h3>
                <strong className="operation-count">{reviews.data?.items.length ?? 0}</strong>
                <p>delivery batches need an administrator decision.</p>
              </article>
            </div>
          ) : null}
          {sending.error ? <ErrorBlock error={sending.error} /> : null}
        </section>
      ) : user.role !== "ADMIN" && tab === "operations" ? (
        <section className="panel-simple viewer-note">
          Operational controls are visible to administrators only.
        </section>
      ) : null}
    </Page>
  );
}
