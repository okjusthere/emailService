import { CheckCircle2, Users } from "lucide-react";
import { useState } from "react";
import type { SavedAudience } from "./useCampaignComposer.js";

type Summary = {
  matched: number;
  eligible: number;
  suppressed: number;
  recentlyEmailed: number;
  previouslyContacted: number;
};
type Criteria = {
  nearbyZipCount: number;
  closedMonths: number;
  limit: number;
  excludeEmailedWithinDays: number;
};

export function RecipientPanel({
  summary,
  pending,
  automatic,
  disabled,
  error,
  onGenerate,
  savedAudiences,
  onSelectAudience,
}: {
  summary: Summary | null;
  pending: boolean;
  automatic: boolean;
  disabled: boolean;
  error: Error | null;
  onGenerate: (criteria: Criteria) => void;
  savedAudiences: SavedAudience[];
  onSelectAudience: (input: {
    savedAudienceId?: string | null;
    filter: Record<string, unknown>;
  }) => void;
}) {
  const [advanced, setAdvanced] = useState(false);
  const [source, setSource] = useState<"nearby" | "saved" | "custom">("nearby");
  const [criteria, setCriteria] = useState<Criteria>({
    nearbyZipCount: 3,
    closedMonths: 12,
    limit: 2000,
    excludeEmailedWithinDays: 14,
  });
  return (
    <section className="composer-card recipient-panel">
      <div className="composer-card-title">
        <span>
          <Users size={19} />
        </span>
        <div>
          <h2>Recipients</h2>
          <p>Agents who recently closed nearby properties.</p>
        </div>
      </div>
      <div className="recipient-source-tabs" role="tablist" aria-label="Recipient source">
        <button
          role="tab"
          aria-selected={source === "nearby"}
          className={source === "nearby" ? "active" : ""}
          onClick={() => setSource("nearby")}
        >
          Nearby active agents
        </button>
        <button
          role="tab"
          aria-selected={source === "saved"}
          className={source === "saved" ? "active" : ""}
          onClick={() => setSource("saved")}
        >
          Saved contact list
        </button>
        <button
          role="tab"
          aria-selected={source === "custom"}
          className={source === "custom" ? "active" : ""}
          onClick={() => setSource("custom")}
        >
          Custom segment
        </button>
      </div>
      {source === "nearby" && summary ? (
        <div className="recipient-summary">
          <CheckCircle2 />
          <div>
            <strong>{summary.eligible.toLocaleString()} people ready</strong>
            <p>
              {summary.matched.toLocaleString()} matched ·{" "}
              {summary.suppressed + summary.recentlyEmailed + summary.previouslyContacted} held back
              for safety
            </p>
          </div>
          <button className="text-button" onClick={() => setAdvanced(!advanced)}>
            Adjust
          </button>
        </div>
      ) : source === "nearby" && automatic && !error ? (
        <div className="suggest-button automatic-recipient-state" aria-live="polite">
          <Users />
          <span>
            <strong>{pending ? "Finding recipients from BBO…" : "Preparing recipients…"}</strong>
            <small>Same ZIP plus 3 nearby ZIP codes · past 12 months</small>
          </span>
        </div>
      ) : source === "nearby" ? (
        <button
          className="suggest-button"
          disabled={pending || disabled}
          onClick={() => onGenerate(criteria)}
        >
          <Users />
          <span>
            <strong>
              {pending
                ? "Finding recipients…"
                : error
                  ? "Retry recipient search"
                  : "Find recipients"}
            </strong>
            <small>Same ZIP plus 3 nearby ZIP codes · past 12 months</small>
          </span>
        </button>
      ) : source === "saved" ? (
        <label className="recipient-select">
          Saved list
          <select
            disabled={disabled}
            defaultValue=""
            onChange={(event) => {
              const selected = savedAudiences.find((item) => item.id === event.target.value);
              if (selected)
                onSelectAudience({ savedAudienceId: selected.id, filter: selected.filter });
            }}
          >
            <option value="" disabled>
              Select a list
            </option>
            {savedAudiences.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {(item.lastEstimatedCount ?? 0).toLocaleString()}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div className="custom-segments">
          <p>Build a safe segment from contacts with a known business or permission source.</p>
          <button
            className="button secondary"
            disabled={disabled}
            onClick={() =>
              onSelectAudience({
                filter: {
                  contactTypes: ["BROKER"],
                  requireKnownPermissionBasis: true,
                  excludeEmailedWithinDays: 14,
                },
              })
            }
          >
            All brokers
          </button>
          <button
            className="button secondary"
            disabled={disabled}
            onClick={() =>
              onSelectAudience({
                filter: { requireKnownPermissionBasis: true, excludeEmailedWithinDays: 14 },
              })
            }
          >
            All eligible contacts
          </button>
        </div>
      )}
      {source === "nearby" && advanced ? (
        <div className="recipient-options">
          <label>
            Nearby ZIP codes
            <select
              value={criteria.nearbyZipCount}
              onChange={(event) =>
                setCriteria({ ...criteria, nearbyZipCount: Number(event.target.value) })
              }
            >
              <option value={0}>Same ZIP only</option>
              <option value={3}>3 nearby ZIPs</option>
              <option value={5}>5 nearby ZIPs</option>
            </select>
          </label>
          <label>
            Closed within
            <select
              value={criteria.closedMonths}
              onChange={(event) =>
                setCriteria({ ...criteria, closedMonths: Number(event.target.value) })
              }
            >
              <option value={12}>12 months</option>
              <option value={18}>18 months</option>
              <option value={24}>24 months</option>
            </select>
          </label>
          <label>
            Skip recently emailed
            <select
              value={criteria.excludeEmailedWithinDays}
              onChange={(event) =>
                setCriteria({ ...criteria, excludeEmailedWithinDays: Number(event.target.value) })
              }
            >
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
            </select>
          </label>
          <button
            className="button secondary"
            disabled={pending || disabled}
            onClick={() => onGenerate(criteria)}
          >
            Update recipients
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error.message}
        </p>
      ) : null}
    </section>
  );
}
