import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { AiStatus, Campaign } from "../../app/types.js";
import { ApiError, api } from "../../lib/api.js";
import { showToast } from "../../components/ui/Toast.js";

export type ComposerDraft = {
  subject: string;
  preheader: string;
  introHtml: string;
  introText: string;
  ctaLabel: string;
  ctaUrl: string;
  templateKey: string;
};

type RecipientCriteria = {
  nearbyZipCount: number;
  closedMonths: number;
  limit: number;
  excludeEmailedWithinDays: number;
};

export type SavedAudience = {
  id: string;
  name: string;
  description?: string | null;
  filter: Record<string, unknown>;
  lastEstimatedCount?: number | null;
};

function track(
  event: string,
  campaignId: string,
  metadata?: Record<string, string | number | boolean | null>
) {
  void api("/api/v2/product-events", {
    method: "POST",
    body: JSON.stringify({ event, campaignId, metadata }),
  }).catch(() => undefined);
}

export function useCampaignComposer(id: string, userEmail: string) {
  const client = useQueryClient();
  const campaign = useQuery({
    queryKey: ["campaign", id],
    queryFn: () => api<Campaign>(`/api/v2/campaigns/${id}`),
  });
  const aiStatus = useQuery({
    queryKey: ["ai-status"],
    queryFn: () => api<AiStatus>("/api/v2/ai/status"),
  });
  const savedAudiences = useQuery({
    queryKey: ["saved-audiences"],
    queryFn: () => api<{ items: SavedAudience[] }>("/api/v2/audiences"),
  });
  const [draft, setDraftState] = useState<ComposerDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "conflict" | "error">("saved");
  const [preview, setPreview] = useState<{ html: string; text: string } | null>(null);
  const [recipientSummary, setRecipientSummary] = useState<{
    matched: number;
    eligible: number;
    suppressed: number;
    recentlyEmailed: number;
    previouslyContacted: number;
  } | null>(null);
  const [aiState, setAiState] = useState<"idle" | "writing" | "done" | "error">("idle");
  const [aiProposal, setAiProposal] = useState<{
    generationId: string;
    variants: Array<Record<string, string>>;
    recommendedIndex: number;
  } | null>(null);
  const revision = useRef(0);
  const aiStarted = useRef(false);
  const estimatedAudience = useRef<string | null>(null);

  useEffect(() => {
    if (!campaign.data || draft) return;
    setDraftState({
      subject: campaign.data.subject,
      preheader: campaign.data.preheader ?? "",
      introHtml: campaign.data.introHtml ?? "",
      introText: campaign.data.introText ?? "",
      ctaLabel: campaign.data.ctaLabel,
      ctaUrl: campaign.data.ctaUrl ?? "https://www.homixny.com/listings",
      templateKey: campaign.data.templateKey,
    });
    if (campaign.data.savedAudience?.lastEstimatedCount != null)
      setRecipientSummary({
        matched: campaign.data.savedAudience.lastEstimatedCount,
        eligible: campaign.data.savedAudience.lastEstimatedCount,
        suppressed: 0,
        recentlyEmailed: 0,
        previouslyContacted: 0,
      });
  }, [campaign.data, draft]);

  useEffect(() => {
    const filter = campaign.data?.audienceFilter;
    if (
      !filter ||
      campaign.data?.savedAudience ||
      typeof filter.excludeEmailedWithinDays !== "number"
    )
      return;
    const key = JSON.stringify(filter);
    if (estimatedAudience.current === key) return;
    estimatedAudience.current = key;
    void api<{
      matched: number;
      eligible: number;
      suppressed: number;
      unknownPermission: number;
    }>("/api/v2/audiences/estimate", { method: "POST", body: key })
      .then((estimate) =>
        setRecipientSummary({
          matched: estimate.matched,
          eligible: estimate.eligible,
          suppressed: estimate.suppressed + estimate.unknownPermission,
          recentlyEmailed: 0,
          previouslyContacted: 0,
        })
      )
      .catch(() => {
        estimatedAudience.current = null;
      });
  }, [campaign.data?.audienceFilter, campaign.data?.savedAudience]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function setDraft(patch: Partial<ComposerDraft>) {
    revision.current += 1;
    setDraftState((current) => (current ? { ...current, ...patch } : current));
    setDirty(true);
  }

  const save = useMutation({
    mutationFn: async ({
      value,
      version,
      editRevision,
    }: {
      value: ComposerDraft;
      version: number;
      editRevision: number;
    }) => {
      setSaveState("saving");
      const updated = await api<Campaign>(`/api/v2/campaigns/${id}`, {
        method: "PATCH",
        headers: { "If-Match": String(version) },
        body: JSON.stringify(value),
      });
      return { updated, editRevision };
    },
    onSuccess: ({ updated, editRevision }) => {
      client.setQueryData(["campaign", id], (current: Campaign | undefined) => ({
        ...current,
        ...updated,
      }));
      if (revision.current === editRevision) setDirty(false);
      setSaveState("saved");
      track("autosave_success", id, { version: updated.version });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === "CAMPAIGN_VERSION_CONFLICT") {
        setSaveState("conflict");
        track("autosave_conflict", id);
      } else setSaveState("error");
    },
  });

  useEffect(() => {
    if (!dirty || !draft || !campaign.data || save.isPending || campaign.data.status !== "DRAFT")
      return;
    const timer = window.setTimeout(
      () =>
        save.mutate({
          value: draft,
          version: campaign.data!.version,
          editRevision: revision.current,
        }),
      800
    );
    return () => window.clearTimeout(timer);
  }, [campaign.data, dirty, draft, save.isPending]);

  const refreshPreview = useMutation({
    mutationFn: () =>
      api<{ html: string; text: string }>(`/api/v2/campaigns/${id}/preview`, {
        method: "POST",
        body: JSON.stringify({ firstName: "Alex" }),
      }),
    onSuccess: setPreview,
  });
  useEffect(() => {
    if (!campaign.data || dirty || save.isPending) return;
    const controller = window.setTimeout(() => refreshPreview.mutate(), 350);
    return () => window.clearTimeout(controller);
  }, [campaign.data?.version, dirty, save.isPending]);

  const recipients = useMutation({
    mutationFn: (criteria: RecipientCriteria) =>
      api<{
        campaign: Campaign;
        summary: {
          matched: number;
          eligible: number;
          suppressed: number;
          recentlyEmailed: number;
          previouslyContacted: number;
        };
      }>(`/api/v2/campaigns/${id}/recipients/onekey-nearby`, {
        method: "POST",
        body: JSON.stringify({ ...criteria, version: campaign.data?.version }),
      }),
    onSuccess: (result) => {
      client.setQueryData(["campaign", id], (current: Campaign | undefined) => ({
        ...current,
        ...result.campaign,
      }));
      setRecipientSummary(result.summary);
      track("recipients_generated", id, { eligible: result.summary.eligible });
    },
  });

  const selectAudience = useMutation({
    mutationFn: async ({
      savedAudienceId,
      filter,
    }: {
      savedAudienceId?: string | null;
      filter: Record<string, unknown>;
    }) => {
      const estimate = await api<{
        matched: number;
        eligible: number;
        suppressed: number;
        unknownPermission: number;
      }>("/api/v2/audiences/estimate", { method: "POST", body: JSON.stringify(filter) });
      const updated = await api<Campaign>(`/api/v2/campaigns/${id}`, {
        method: "PATCH",
        headers: { "If-Match": String(campaign.data?.version) },
        body: JSON.stringify({ savedAudienceId: savedAudienceId ?? null, audienceFilter: filter }),
      });
      return { updated, estimate };
    },
    onSuccess: ({ updated, estimate }) => {
      client.setQueryData(["campaign", id], (current: Campaign | undefined) => ({
        ...current,
        ...updated,
      }));
      setRecipientSummary({
        matched: estimate.matched,
        eligible: estimate.eligible,
        suppressed: estimate.suppressed + estimate.unknownPermission,
        recentlyEmailed: 0,
        previouslyContacted: 0,
      });
      track("recipient_source_selected", id, { eligible: estimate.eligible });
    },
  });

  const generateAi = useMutation({
    mutationFn: async (tone: "concise" | "warm" | "professional" | "luxury" = "professional") => {
      const startingRevision = revision.current;
      setAiState("writing");
      track("ai_draft_started", id);
      const generated = await api<{
        generationId: string;
        proposal: { variants: Array<Record<string, string>>; recommendedIndex: number };
      }>(`/api/v2/campaigns/${id}/ai/generate`, {
        method: "POST",
        body: JSON.stringify({ tone }),
      });
      if (revision.current !== startingRevision)
        throw new Error("Your edits were kept because the draft changed while AI was writing.");
      const applied = await api<Campaign>(`/api/v2/campaigns/${id}/ai/apply`, {
        method: "POST",
        body: JSON.stringify({
          generationId: generated.generationId,
          variantIndex: generated.proposal.recommendedIndex,
          fields: ["subject", "preheader", "introText", "ctaLabel"],
          version: campaign.data?.version,
        }),
      });
      return { applied, generated };
    },
    onSuccess: ({ applied: updated, generated }) => {
      client.setQueryData(["campaign", id], (current: Campaign | undefined) => ({
        ...current,
        ...updated,
      }));
      setDraftState((current) =>
        current
          ? {
              ...current,
              subject: updated.subject,
              preheader: updated.preheader ?? "",
              introText: updated.introText ?? "",
              introHtml: updated.introHtml ?? "",
              ctaLabel: updated.ctaLabel,
            }
          : current
      );
      setDirty(false);
      setAiProposal({
        generationId: generated.generationId,
        variants: generated.proposal.variants,
        recommendedIndex: generated.proposal.recommendedIndex,
      });
      setAiState("done");
      sessionStorage.setItem(`homix-ai-draft:${id}`, "done");
      track("ai_draft_completed", id);
      track("ai_draft_generated", id);
      showToast("AI draft ready");
    },
    onError: () => {
      setAiState("error");
      track("ai_draft_failed", id);
    },
  });

  const applyAiVariant = useMutation({
    mutationFn: (variantIndex: number) => {
      if (!aiProposal) throw new Error("Generate an AI draft before choosing a variant.");
      return api<Campaign>(`/api/v2/campaigns/${id}/ai/apply`, {
        method: "POST",
        body: JSON.stringify({
          generationId: aiProposal.generationId,
          variantIndex,
          fields: ["subject", "preheader", "introText", "ctaLabel"],
          version: campaign.data?.version,
        }),
      });
    },
    onSuccess: (updated) => {
      client.setQueryData(["campaign", id], (current: Campaign | undefined) => ({
        ...current,
        ...updated,
      }));
      setDraftState((current) =>
        current
          ? {
              ...current,
              subject: updated.subject,
              preheader: updated.preheader ?? "",
              introText: updated.introText ?? "",
              introHtml: updated.introHtml ?? "",
              ctaLabel: updated.ctaLabel,
            }
          : current
      );
      setDirty(false);
      setAiState("done");
    },
  });

  useEffect(() => {
    if (
      !campaign.data ||
      !aiStatus.data?.productionReady ||
      dirty ||
      save.isPending ||
      generateAi.isPending ||
      aiState !== "idle" ||
      aiStarted.current
    )
      return;
    if (sessionStorage.getItem(`homix-ai-draft:${id}`)) return;
    aiStarted.current = true;
    generateAi.mutate("professional");
  }, [aiStatus.data?.productionReady, campaign.data?.id, dirty, save.isPending]);

  const testSend = useMutation({
    mutationFn: () => {
      track("test_send_started", id);
      return api(`/api/v2/campaigns/${id}/test-send`, {
        method: "POST",
        body: JSON.stringify({
          email: userEmail,
          version: campaign.data?.version,
          clientRequestId: crypto.randomUUID(),
        }),
      });
    },
    onSuccess: () => {
      void campaign.refetch();
      track("test_send_completed", id);
      track("test_send_succeeded", id);
      showToast(`Test sent to ${userEmail}`);
    },
  });

  const publish = useMutation({
    mutationFn: (scheduledAt?: string) => {
      track("publish_started", id, { scheduled: Boolean(scheduledAt) });
      return api<Campaign>(`/api/v2/campaigns/${id}/publish`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          version: campaign.data?.version,
          scheduledAt: scheduledAt || undefined,
        }),
      });
    },
    onSuccess: (updated, scheduledAt) => {
      client.setQueryData(["campaign", id], (current: Campaign | undefined) => ({
        ...current,
        ...updated,
      }));
      track("publish_confirmed", id);
      track("publish_succeeded", id);
      showToast(scheduledAt ? "Campaign scheduled" : "Campaign queued");
    },
    onError: () => track("publish_failed", id),
  });

  function retrySave() {
    if (!draft || !campaign.data || save.isPending) return;
    save.mutate({ value: draft, version: campaign.data.version, editRevision: revision.current });
  }

  return {
    campaign,
    draft,
    setDraft,
    dirty,
    saveState,
    save,
    retrySave,
    preview,
    previewError: refreshPreview.error,
    recipientSummary,
    recipients,
    savedAudiences,
    selectAudience,
    aiStatus,
    aiState,
    aiProposal,
    generateAi,
    applyAiVariant,
    testSend,
    publish,
  };
}
