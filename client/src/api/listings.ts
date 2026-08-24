import type { ListResponse, Listing } from "../app/types.js";
import { api } from "../lib/api.js";

export const listingsApi = {
  list: (query = "limit=100") => api<ListResponse<Listing>>(`/api/v2/listings?${query}`),
  create: (body: unknown) =>
    api<Listing>("/api/v2/listings", { method: "POST", body: JSON.stringify(body) }),
};
