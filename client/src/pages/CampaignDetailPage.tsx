import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronLeft, Download, Pause, Play, XCircle } from "lucide-react";
import { Link, Navigate, useParams } from "react-router-dom";
import type { Campaign, ListResponse } from "../app/types.js";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/ui/Feedback.js";
import { StatusBadge } from "../components/ui/StatusBadge.js";
import { api, formatEt } from "../lib/api.js";

export function CampaignDetailPage() {
  const { id = "" } = useParams();
  const campaign = useQuery({
    queryKey: ["campaign", id],
    queryFn: () => api<Campaign>(`/api/v2/campaigns/${id}`),
    refetchInterval: 5_000,
  });
  const recipients = useQuery({
    queryKey: ["campaign-recipients", id],
    queryFn: () =>
      api<
        ListResponse<{
          id: string;
          displayName?: string;
          email: string;
          company?: string;
          sendState: string;
          deliveryState: string;
        }>
      >(`/api/v2/campaigns/${id}/recipients?limit=25`),
    refetchInterval: 5_000,
  });
  const action = useMutation({
    mutationFn: (name: "pause" | "resume" | "cancel") =>
      api(`/api/v2/campaigns/${id}/${name}`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => void campaign.refetch(),
  });
  if (campaign.isLoading)
    return (
      <main className="simple-page">
        <LoadingBlock />
      </main>
    );
  if (campaign.error || !campaign.data)
    return (
      <main className="simple-page">
        <ErrorBlock error={campaign.error} />
      </main>
    );
  if (campaign.data.status === "DRAFT") return <Navigate to={`/campaigns/${id}/edit`} replace />;
  const item = campaign.data;
  const report = item.reportingSummary;
  const clicks = report?.clicks;
  return (
    <main className="simple-page campaign-detail-page">
      <Link className="back-link" to="/campaigns">
        <ChevronLeft size={17} /> Campaigns
      </Link>
      <header className="campaign-detail-head">
        <div>
          <StatusBadge value={item.status} />
          <h1>{item.name}</h1>
          <p>
            {item.listing?.title} · {item.senderProfile?.fromEmail}
          </p>
        </div>
        <div className="detail-buttons">
          {item.status === "SENDING" ? (
            <button className="button secondary" onClick={() => action.mutate("pause")}>
              <Pause size={16} /> Pause
            </button>
          ) : null}
          {item.status === "PAUSED" ? (
            <button className="button primary" onClick={() => action.mutate("resume")}>
              <Play size={16} /> Resume
            </button>
          ) : null}
          {["READY", "SCHEDULED", "QUEUED", "SENDING", "PAUSED"].includes(item.status) ? (
            <button
              className="button danger-button"
              onClick={() =>
                window.confirm("Cancel all unsent deliveries?") && action.mutate("cancel")
              }
            >
              <XCircle size={16} /> Cancel
            </button>
          ) : null}
        </div>
      </header>
      {item.status === "SNAPSHOTTING" || item.status === "QUEUED" ? (
        <div className="progress-banner">
          <span className="pulse-dot" /> Preparing the recipient list and delivery batches. This
          page updates automatically.
        </div>
      ) : null}
      <section className="metric-grid">
        <article>
          <span>Eligible</span>
          <strong>{(item.eligibleCount ?? 0).toLocaleString()}</strong>
        </article>
        <article>
          <span>Sent</span>
          <strong>
            {(report?.delivery.acceptedCount ?? item.acceptedCount ?? 0).toLocaleString()}
          </strong>
        </article>
        <article>
          <span title="Accepted by the recipient's mail server; this does not confirm inbox placement or reading.">
            Delivered
          </span>
          <strong>{report?.delivery.deliveredCount.toLocaleString() ?? "—"}</strong>
        </article>
        <article>
          <span>Awaiting delivery confirmation</span>
          <strong>{report?.delivery.pendingCount.toLocaleString() ?? "—"}</strong>
        </article>
        <article>
          <span>Delivery issues</span>
          <strong>{report?.delivery.undeliveredCount.toLocaleString() ?? "—"}</strong>
        </article>
        <article>
          <span>Listing link clicks</span>
          <strong>{clicks?.count?.toLocaleString() ?? "—"}</strong>
        </article>
      </section>
      <p>
        {!clicks || clicks.availability === "unknown"
          ? "Click tracking coverage is unavailable for this activity. Missing data does not mean nobody viewed the listing."
          : clicks.availability === "disabled"
            ? "Click tracking was not enabled for these messages."
            : clicks.availability === "partial"
              ? `Click tracking covers ${clicks.coverageSentCount.toLocaleString()} sent messages${clicks.startedAt ? `, beginning ${formatEt(clicks.startedAt)}` : ""}. Earlier or untracked messages are excluded.`
              : clicks.count === 0
                ? "No listing link clicks have been recorded yet."
                : "Listing link clicks are counted once per recipient message; they do not prove a person read the email."}
      </p>
      {report ? (
        <p>
          Updated {formatEt(report.asOf)}. Delivery and click events may arrive after sending
          completes.
        </p>
      ) : null}
      <section className="detail-grid">
        <article className="panel-simple">
          <span className="eyebrow">Email</span>
          <h2>{item.subject}</h2>
          <p>{item.preheader}</p>
          <dl className="simple-dl">
            <div>
              <dt>Sent or scheduled</dt>
              <dd>{formatEt(item.scheduledAt)}</dd>
            </div>
            <div>
              <dt>Reply to</dt>
              <dd>{item.replyToAgent?.email}</dd>
            </div>
          </dl>
        </article>
        <article className="panel-simple">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Recipients</span>
              <h2>Delivery sample</h2>
            </div>
            <a className="button secondary" href={`/api/v2/campaigns/${id}/export.csv`}>
              <Download size={16} /> Export
            </a>
          </div>
          {recipients.isLoading ? (
            <LoadingBlock />
          ) : recipients.data?.items.length ? (
            <div className="recipient-list">
              {recipients.data.items.map((recipient) => (
                <div key={recipient.id}>
                  <span>
                    <strong>{recipient.displayName ?? recipient.email}</strong>
                    <small>{recipient.company ?? recipient.email}</small>
                  </span>
                  <span>
                    {recipient.deliveryState !== "UNKNOWN"
                      ? recipient.deliveryState
                      : recipient.sendState}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyBlock title="Recipients are being prepared">Refresh in a moment.</EmptyBlock>
          )}
        </article>
      </section>
      {action.error ? <ErrorBlock error={action.error} /> : null}
    </main>
  );
}
