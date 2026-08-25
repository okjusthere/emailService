import type { Listing } from "../app/types.js";
import { api } from "../lib/api.js";

export type OneKeySearchResult = {
  sourceKey: string;
  listingId?: string | null;
  importedListingId?: string | null;
  unparsedAddress: string;
  city: string;
  stateCode: string;
  postalCode: string;
  listPrice?: string | null;
  standardStatus?: string | null;
  propertyType?: string | null;
  transactionType?: string | null;
  listAgentFullName?: string | null;
  imageUrls?: string[];
};

export const oneKeyApi = {
  search: (query: string, signal?: AbortSignal) =>
    api<{ items: OneKeySearchResult[] }>(
      `/api/v2/onekey/listings/search?q=${encodeURIComponent(query)}&limit=12`,
      { signal }
    ),
  import: (sourceKey: string, agentId: string) =>
    api<{ listing: Listing }>(`/api/v2/onekey/listings/${encodeURIComponent(sourceKey)}/import`, {
      method: "POST",
      body: JSON.stringify({ agentId }),
    }),
};
