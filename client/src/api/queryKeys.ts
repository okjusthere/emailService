export const queryKeys = {
  campaign: (id: string) => ["campaign", id] as const,
  campaigns: (filters = "") => ["campaigns", filters] as const,
  listings: (filters = "") => ["listings", filters] as const,
  propertySearch: (query: string) => ["property-search", query] as const,
  contacts: (filters = "") => ["contacts", filters] as const,
  audiences: ["saved-audiences"] as const,
  settings: ["settings"] as const,
};
