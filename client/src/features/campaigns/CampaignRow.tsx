import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { Campaign } from "../../app/types.js";
import { formatEt } from "../../lib/api.js";
import { StatusBadge } from "../../components/ui/StatusBadge.js";

export function CampaignRow({ campaign }: { campaign: Campaign }) {
  const href =
    campaign.status === "DRAFT" ? `/campaigns/${campaign.id}/edit` : `/campaigns/${campaign.id}`;
  return (
    <Link className="campaign-row" to={href}>
      <div>
        <strong>{campaign.name}</strong>
        <span>
          {campaign.listing?.title ?? "Property unavailable"} · {campaign.subject} ·{" "}
          {(campaign.eligibleCount ?? 0).toLocaleString()} recipients · Updated{" "}
          {formatEt(campaign.updatedAt)}
        </span>
      </div>
      <StatusBadge value={campaign.status} />
      <ArrowRight size={18} aria-hidden="true" />
    </Link>
  );
}
