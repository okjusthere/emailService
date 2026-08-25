export type SelectableAgent = {
  id: string;
  displayName: string;
  isActive: boolean;
};

function normalizedName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function matchingAgentId(
  listingAgentName: string | null | undefined,
  agents: SelectableAgent[]
) {
  if (!listingAgentName?.trim()) return "";
  const target = normalizedName(listingAgentName);
  return (
    agents.find((agent) => agent.isActive && normalizedName(agent.displayName) === target)?.id ?? ""
  );
}
