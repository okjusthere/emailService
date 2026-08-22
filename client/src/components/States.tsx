import type { PropsWithChildren } from "react";

export function LoadingState() {
  return (
    <div className="state-card">
      <span className="spinner" /> Loading the latest records…
    </div>
  );
}
export function EmptyState({ title, children }: PropsWithChildren<{ title: string }>) {
  return (
    <div className="state-card empty">
      <span className="eyebrow">Nothing here yet</span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function ErrorState({ error }: { error: Error }) {
  return (
    <div className="state-card error">
      <span className="eyebrow">Action needed</span>
      <h3>{error.message}</h3>
      <p>
        Try again. If this persists, copy the request ID from the error response for Operations.
      </p>
    </div>
  );
}
export function StatusPill({ value }: { value: string }) {
  return (
    <span className={`status status-${value.toLowerCase().replaceAll("_", "-")}`}>
      {value.replaceAll("_", " ")}
    </span>
  );
}
