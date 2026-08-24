const friendly: Record<string, string> = {
  DRAFT: "In progress",
  READY: "Ready to send",
  SNAPSHOTTING: "Preparing",
  SCHEDULED: "Scheduled",
  QUEUED: "Preparing",
  SENDING: "Sending",
  PAUSED: "Paused",
  COMPLETED: "Sent",
  CANCELLED: "Cancelled",
  FAILED: "Needs attention",
  ACTIVE: "Active",
  VERIFIED: "Verified",
};

export function StatusBadge({ value }: { value: string }) {
  return (
    <span className={`status-badge status-${value.toLowerCase()}`}>{friendly[value] ?? value}</span>
  );
}
