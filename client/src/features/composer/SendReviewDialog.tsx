import { AlertTriangle, Check, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Campaign } from "../../app/types.js";

export function SendReviewDialog({
  campaign,
  eligible,
  excluded,
  pending,
  error,
  onClose,
  onPublish,
}: {
  campaign: Campaign;
  eligible: number;
  excluded: number;
  pending: boolean;
  error: Error | null;
  onClose: () => void;
  onPublish: (scheduledAt?: string) => void;
}) {
  const [schedule, setSchedule] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>("button, input")?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [
        ...dialog.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])"),
      ];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      previous?.focus();
    };
  }, []);
  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="send-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="send-review-title"
      >
        <button className="icon-button dialog-close" aria-label="Close" onClick={onClose}>
          <X />
        </button>
        <span className="dialog-icon">
          <Send />
        </span>
        <h2 id="send-review-title">Ready to send?</h2>
        <p>
          Review the final details. After you confirm, the recipient list and email content are
          locked.
        </p>
        <dl>
          <div>
            <dt>Property</dt>
            <dd>{campaign.listing?.title}</dd>
          </div>
          <div>
            <dt>Recipients</dt>
            <dd>{eligible.toLocaleString()} eligible</dd>
          </div>
          <div>
            <dt>Excluded</dt>
            <dd>{excluded.toLocaleString()}</dd>
          </div>
          <div>
            <dt>From</dt>
            <dd>{campaign.senderProfile?.fromEmail}</dd>
          </div>
          <div>
            <dt>Reply to</dt>
            <dd>{campaign.replyToAgent?.email}</dd>
          </div>
          <div>
            <dt>Subject</dt>
            <dd>{campaign.subject}</dd>
          </div>
        </dl>
        <label className="schedule-toggle">
          <input
            type="checkbox"
            checked={schedule}
            onChange={(event) => setSchedule(event.target.checked)}
          />{" "}
          Schedule for later
        </label>
        {schedule ? (
          <label>
            Send date and time
            <input
              type="datetime-local"
              value={scheduledAt}
              min={new Date().toISOString().slice(0, 16)}
              onChange={(event) => setScheduledAt(event.target.value)}
            />
          </label>
        ) : null}
        <div className="safety-note">
          <AlertTriangle />
          <span>
            Unsubscribed, bounced, and recently contacted recipients will be excluded automatically.
          </span>
        </div>
        {error ? (
          <p className="form-error" role="alert">
            {error.message}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={pending || (schedule && !scheduledAt)}
            onClick={() => onPublish(schedule ? new Date(scheduledAt).toISOString() : undefined)}
          >
            <Check size={17} />{" "}
            {pending
              ? "Preparing…"
              : schedule
                ? "Schedule email"
                : `Send to ${eligible.toLocaleString()} recipients`}
          </button>
        </div>
      </section>
    </div>
  );
}
