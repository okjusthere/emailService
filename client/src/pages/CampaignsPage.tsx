import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { Campaign, ListResponse } from "../app/types.js";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/ui/Feedback.js";
import { Page } from "../components/ui/Page.js";
import { CampaignRow } from "../features/campaigns/CampaignRow.js";
import { api } from "../lib/api.js";

const tabs = ["ALL", "DRAFT", "SCHEDULED", "SENDING", "COMPLETED", "ATTENTION"] as const;
const activeStatuses = new Set([
  "READY",
  "SNAPSHOTTING",
  "SCHEDULED",
  "QUEUED",
  "SENDING",
  "PAUSED",
  "FAILED",
]);

export function CampaignsPage() {
  const [tab, setTab] = useState<(typeof tabs)[number]>("ALL");
  const [search, setSearch] = useState("");
  const campaigns = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => api<ListResponse<Campaign>>("/api/v2/campaigns?limit=100"),
  });
  const filtered = (campaigns.data?.items ?? []).filter((campaign) => {
    const matchesSearch = `${campaign.name} ${campaign.subject} ${campaign.listing?.title ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase());
    const matchesTab =
      tab === "ALL" ||
      (tab === "ATTENTION"
        ? ["FAILED", "PAUSED"].includes(campaign.status)
        : tab === "SENDING"
          ? activeStatuses.has(campaign.status) && !["SCHEDULED", "DRAFT"].includes(campaign.status)
          : campaign.status === tab);
    return matchesSearch && matchesTab;
  });
  return (
    <Page
      title="Campaigns"
      description="Draft, scheduled, and sent listing emails."
      action={
        <Link className="button primary" to="/campaigns/new">
          <Plus size={16} /> Create listing email
        </Link>
      }
    >
      <label className="small-search campaign-search">
        <Search size={16} />
        <span className="sr-only">Search campaigns</span>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search campaigns"
        />
      </label>
      <div className="segmented" role="tablist" aria-label="Campaign status">
        {tabs.map((item) => (
          <button
            key={item}
            role="tab"
            aria-selected={tab === item}
            className={tab === item ? "active" : ""}
            onClick={() => setTab(item)}
          >
            {item === "ALL"
              ? "All"
              : item === "DRAFT"
                ? "In progress"
                : item === "COMPLETED"
                  ? "Sent"
                  : item === "ATTENTION"
                    ? "Needs attention"
                    : item.charAt(0) + item.slice(1).toLowerCase()}
          </button>
        ))}
      </div>
      <section className="campaign-list panel-simple">
        {campaigns.isLoading ? (
          <LoadingBlock />
        ) : campaigns.error ? (
          <ErrorBlock error={campaigns.error} />
        ) : filtered.length ? (
          filtered.map((campaign) => <CampaignRow key={campaign.id} campaign={campaign} />)
        ) : (
          <EmptyBlock title="No matching campaigns">
            Create a listing email or change the search and status filters.
          </EmptyBlock>
        )}
      </section>
    </Page>
  );
}
