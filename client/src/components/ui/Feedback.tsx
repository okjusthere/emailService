import { AlertCircle, Inbox, LoaderCircle } from "lucide-react";

export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="feedback-block" role="status" aria-live="polite" aria-busy="true">
      <LoaderCircle className="spin" /> <span>{label}</span>
    </div>
  );
}

export function EmptyBlock({ title, children }: React.PropsWithChildren<{ title: string }>) {
  return (
    <div className="feedback-block empty">
      <Inbox />
      <div>
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
    </div>
  );
}

export function ErrorBlock({ error }: { error: unknown }) {
  return (
    <div className="feedback-block error" role="alert">
      <AlertCircle />
      <div>
        <strong>Something went wrong</strong>
        <p>{error instanceof Error ? error.message : "Please try again."}</p>
      </div>
    </div>
  );
}
