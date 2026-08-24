import { CheckCircle2, ChevronLeft, Eye, MailCheck, Save, Send, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import type { User } from "../app/types.js";
import { ErrorBlock, LoadingBlock } from "../components/ui/Feedback.js";
import { PropertyCard } from "../features/properties/PropertyCard.js";
import { MessagePanel } from "../features/composer/MessagePanel.js";
import { RecipientPanel } from "../features/composer/RecipientPanel.js";
import { SendReviewDialog } from "../features/composer/SendReviewDialog.js";
import { useCampaignComposer } from "../features/composer/useCampaignComposer.js";

export function CampaignComposerPage({ user }: { user: User }) {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [showSend, setShowSend] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);
  const composer = useCampaignComposer(id, user.email);
  if (composer.campaign.isLoading)
    return (
      <main className="composer-loading">
        <LoadingBlock label="Opening your email…" />
      </main>
    );
  if (composer.campaign.error || !composer.campaign.data)
    return (
      <main className="simple-page">
        <ErrorBlock error={composer.campaign.error ?? new Error("Campaign not found.")} />
      </main>
    );
  if (!composer.draft)
    return (
      <main className="composer-loading">
        <LoadingBlock label="Opening your email…" />
      </main>
    );
  const campaign = composer.campaign.data;
  if (campaign.status !== "DRAFT") return <Navigate to={`/campaigns/${id}`} replace />;
  const tested =
    campaign.lastTestedVersion === campaign.version && Boolean(campaign.lastSuccessfulTestAt);
  const testedForCurrentDraft = tested && !composer.dirty;
  const eligible =
    composer.recipientSummary?.eligible ?? campaign.savedAudience?.lastEstimatedCount ?? 0;
  const canTest =
    eligible > 0 &&
    !composer.dirty &&
    composer.saveState === "saved" &&
    !composer.generateAi.isPending;
  const canSend = canTest && testedForCurrentDraft;

  return (
    <main className="composer-page">
      <header className="composer-head">
        <div>
          <Link to="/" className="back-link">
            <ChevronLeft size={17} /> Home
          </Link>
          <h1>Create listing email</h1>
        </div>
        <span className={`save-indicator ${composer.saveState}`}>
          <Save size={15} />{" "}
          {composer.saveState === "saving"
            ? "Saving…"
            : composer.saveState === "conflict"
              ? "Newer version found"
              : composer.saveState === "error"
                ? "Couldn’t save"
                : "Saved"}
        </span>
      </header>
      {composer.saveState === "conflict" ? (
        <div className="conflict-banner">
          <TriangleAlert /> This email changed in another window. Reload to avoid overwriting it.
          <button className="button secondary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      ) : null}
      {composer.saveState === "error" ? (
        <div className="conflict-banner" role="alert">
          <TriangleAlert /> Your work could not be saved. Check your connection and try again.
          <button className="button secondary" onClick={composer.retrySave}>
            Retry
          </button>
        </div>
      ) : null}
      <div className="composer-layout">
        <div className="composer-form">
          {campaign.listing ? (
            <section className="composer-card">
              <div className="composer-card-label">1 · Property</div>
              <PropertyCard listing={campaign.listing} compact />
              <div className="property-actions">
                <Link className="text-button" to="/">
                  Change property
                </Link>
                <Link className="text-button" to="/properties">
                  Edit property details
                </Link>
              </div>
            </section>
          ) : (
            <ErrorBlock error={new Error("This email has no property.")} />
          )}
          <RecipientPanel
            summary={composer.recipientSummary}
            pending={composer.recipients.isPending}
            disabled={composer.dirty || composer.save.isPending}
            error={composer.recipients.error ?? composer.selectAudience.error}
            onGenerate={(criteria) => composer.recipients.mutate(criteria)}
            savedAudiences={composer.savedAudiences.data?.items ?? []}
            onSelectAudience={(input) => composer.selectAudience.mutate(input)}
          />
          <MessagePanel
            draft={composer.draft}
            aiState={composer.aiState}
            aiReady={Boolean(composer.aiStatus.data?.productionReady)}
            aiPending={composer.generateAi.isPending}
            actionsDisabled={composer.dirty || composer.save.isPending}
            onChange={composer.setDraft}
            onRewrite={(tone) => composer.generateAi.mutate(tone)}
            variants={composer.aiProposal?.variants ?? []}
            onVariant={(index) => composer.applyAiVariant.mutate(index)}
          />
          <details className="composer-card advanced-card">
            <summary>Advanced settings</summary>
            <div className="advanced-grid">
              <label>
                Call-to-action label
                <input
                  value={composer.draft.ctaLabel}
                  onChange={(event) => composer.setDraft({ ctaLabel: event.target.value })}
                />
              </label>
              <label>
                Listing link
                <input
                  type="url"
                  value={composer.draft.ctaUrl}
                  onChange={(event) => composer.setDraft({ ctaUrl: event.target.value })}
                />
              </label>
              <label>
                Layout
                <select
                  value={composer.draft.templateKey}
                  onChange={(event) => composer.setDraft({ templateKey: event.target.value })}
                >
                  <option value="LISTING_BRANDED">Branded listing</option>
                  <option value="BROKER_PERSONAL">Agent personal</option>
                </select>
              </label>
              <div className="readonly-setting">
                <span>From</span>
                <strong>{campaign.senderProfile?.fromEmail}</strong>
              </div>
              <div className="readonly-setting">
                <span>Replies go to</span>
                <strong>{campaign.replyToAgent?.email}</strong>
              </div>
            </div>
          </details>
        </div>
        <aside className={`composer-preview ${mobilePreviewOpen ? "mobile-open" : ""}`}>
          <div className="preview-head">
            <div>
              <Eye size={18} />
              <strong>Email preview</strong>
            </div>
            <div className="preview-device" role="group" aria-label="Preview size">
              <button
                className={previewDevice === "desktop" ? "active" : ""}
                onClick={() => setPreviewDevice("desktop")}
              >
                Desktop
              </button>
              <button
                className={previewDevice === "mobile" ? "active" : ""}
                onClick={() => setPreviewDevice("mobile")}
              >
                Mobile
              </button>
            </div>
            <button
              className="text-button mobile-only"
              aria-expanded={mobilePreviewOpen}
              onClick={() => setMobilePreviewOpen(!mobilePreviewOpen)}
            >
              {mobilePreviewOpen ? "Hide" : "Show"}
            </button>
          </div>
          <div className="preview-envelope">
            <span>
              <strong>From:</strong> {campaign.senderProfile?.fromName ?? "Homix Realty"} &lt;
              {campaign.senderProfile?.fromEmail}&gt;
            </span>
            <span>
              <strong>Reply-To:</strong> {campaign.replyToAgent?.displayName} &lt;
              {campaign.replyToAgent?.email}&gt;
            </span>
            <span>
              <strong>Subject:</strong> {composer.draft.subject}
            </span>
          </div>
          <div className="preview-canvas">
            {composer.preview ? (
              <iframe
                className={previewDevice}
                title="Email preview"
                sandbox=""
                srcDoc={composer.preview.html}
              />
            ) : composer.previewError ? (
              <ErrorBlock error={composer.previewError} />
            ) : (
              <LoadingBlock label="Building preview…" />
            )}
          </div>
          <div className="composer-actions">
            <div className="test-status">
              {testedForCurrentDraft ? (
                <>
                  <CheckCircle2 /> Test sent to {user.email}
                </>
              ) : composer.dirty && campaign.lastSuccessfulTestAt ? (
                <>
                  <MailCheck /> Needs a new test after edits
                </>
              ) : (
                <>
                  <MailCheck /> Send yourself a test first
                </>
              )}
            </div>
            <button
              className="button secondary"
              disabled={!canTest || composer.testSend.isPending}
              onClick={() => composer.testSend.mutate()}
            >
              {composer.testSend.isPending ? "Sending test…" : "Send test to me"}
            </button>
            {composer.testSend.error ? (
              <p className="form-error">{composer.testSend.error.message}</p>
            ) : null}
            <button
              className="button primary send-button"
              disabled={!canSend}
              onClick={() => setShowSend(true)}
            >
              <Send size={17} /> Review & send
            </button>
            {!eligible ? (
              <small>Suggest recipients to continue.</small>
            ) : !tested ? (
              <small>A successful test unlocks sending.</small>
            ) : null}
          </div>
        </aside>
      </div>
      {showSend ? (
        <SendReviewDialog
          campaign={campaign}
          eligible={eligible}
          excluded={
            composer.recipientSummary
              ? composer.recipientSummary.matched - composer.recipientSummary.eligible
              : 0
          }
          pending={composer.publish.isPending}
          error={composer.publish.error}
          onClose={() => setShowSend(false)}
          onPublish={(scheduledAt) =>
            composer.publish.mutate(scheduledAt, {
              onSuccess: () => {
                void navigate(`/campaigns/${id}`);
              },
            })
          }
        />
      ) : null}
    </main>
  );
}
