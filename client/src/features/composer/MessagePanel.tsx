import { Sparkles } from "lucide-react";
import type { ComposerDraft } from "./useCampaignComposer.js";

export function MessagePanel({
  draft,
  aiState,
  aiReady,
  aiPending,
  actionsDisabled,
  onChange,
  onRewrite,
  variants,
  onVariant,
}: {
  draft: ComposerDraft;
  aiState: string;
  aiReady: boolean;
  aiPending: boolean;
  actionsDisabled: boolean;
  onChange: (patch: Partial<ComposerDraft>) => void;
  onRewrite: (tone: "concise" | "warm" | "professional" | "luxury") => void;
  variants: Array<Record<string, string>>;
  onVariant: (index: number) => void;
}) {
  return (
    <section className="composer-card message-panel">
      <span className="composer-card-label">AI writing assistant</span>
      <div className="composer-card-title">
        <span>
          <Sparkles size={19} />
        </span>
        <div>
          <h2>Message</h2>
          <p>
            {aiState === "writing"
              ? "Writing your email…"
              : aiState === "error"
                ? "The starter draft is ready; AI is temporarily unavailable."
                : "AI draft — review before sending. Edit anything you like."}
          </p>
        </div>
        {aiReady ? (
          <label className="rewrite-menu">
            <span className="sr-only">Rewrite style</span>
            <select
              disabled={aiPending || actionsDisabled}
              defaultValue=""
              onChange={(event) => {
                if (event.target.value)
                  onRewrite(event.target.value as "concise" | "warm" | "professional" | "luxury");
                event.target.value = "";
              }}
            >
              <option value="" disabled>
                Rewrite
              </option>
              <option value="concise">More concise</option>
              <option value="warm">More personal</option>
              <option value="professional">More professional</option>
              <option value="luxury">Focus on investment details</option>
            </select>
          </label>
        ) : null}
      </div>
      {variants.length ? (
        <div className="subject-variants" role="group" aria-label="AI writing options">
          {variants.map((variant, index) => (
            <button
              key={`${variant.subject}-${index}`}
              type="button"
              disabled={aiPending || actionsDisabled}
              onClick={() => onVariant(index)}
            >
              <span>Option {index + 1}</span>
              {variant.subject}
            </button>
          ))}
        </div>
      ) : null}
      <label>
        Subject
        <input
          value={draft.subject}
          maxLength={150}
          onChange={(event) => onChange({ subject: event.target.value })}
        />
      </label>
      <label>
        Preview text
        <input
          value={draft.preheader}
          maxLength={200}
          onChange={(event) => onChange({ preheader: event.target.value })}
        />
      </label>
      <label>
        Message
        <textarea
          rows={8}
          value={draft.introText}
          maxLength={5000}
          onChange={(event) => {
            const text = event.target.value;
            onChange({
              introText: text,
              introHtml: `<p>${text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\n", "</p><p>")}</p>`,
            });
          }}
        />
      </label>
      <div className="field-count">{draft.introText.length.toLocaleString()} / 5,000</div>
    </section>
  );
}
