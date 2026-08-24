import { useQuery } from "@tanstack/react-query";
import { Page } from "../components/ui/Page.js";
import { ErrorBlock, LoadingBlock } from "../components/ui/Feedback.js";
import { api } from "../lib/api.js";

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

export function ReportsPage() {
  const summary = useQuery({
    queryKey: ["summary"],
    queryFn: () => api<Summary>("/api/v2/dashboard/summary"),
  });
  return (
    <Page title="Reports" description="A concise view of reach and delivery over the last 30 days.">
      {summary.isLoading ? (
        <LoadingBlock />
      ) : summary.error ? (
        <ErrorBlock error={summary.error} />
      ) : (
        <>
          <section className="metric-grid report-metrics">
            <article>
              <span>Campaigns</span>
              <strong>{summary.data!.campaignsLast30Days}</strong>
            </article>
            <article>
              <span>Accepted</span>
              <strong>{summary.data!.accepted.toLocaleString()}</strong>
            </article>
            <article>
              <span>Delivered</span>
              <strong>{summary.data!.delivered.toLocaleString()}</strong>
            </article>
            <article>
              <span>Clicked</span>
              <strong>{summary.data!.clicked.toLocaleString()}</strong>
            </article>
          </section>
          <section className="panel-simple report-note">
            <h2>Audience health</h2>
            <p>
              <strong>{summary.data!.eligibleContacts.toLocaleString()}</strong> eligible contacts
              are available. <strong>{summary.data!.suppressed.toLocaleString()}</strong> addresses
              are held back globally.
            </p>
            {summary.data!.manualReview ? (
              <p className="form-error">
                {summary.data!.manualReview} delivery batch requires administrator review.
              </p>
            ) : (
              <p>There are no unresolved delivery reviews.</p>
            )}
          </section>
        </>
      )}
    </Page>
  );
}
