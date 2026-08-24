import type { Campaign, ListResponse } from "../app/types.js";
import { api } from "../lib/api.js";

export const campaignsApi = {
  list: (query = "limit=100") => api<ListResponse<Campaign>>(`/api/v2/campaigns?${query}`),
  get: (id: string) => api<Campaign>(`/api/v2/campaigns/${id}`),
  quickStart: (listingId: string) =>
    api<{ campaign: Campaign; created: boolean }>("/api/v2/campaigns/quick-start", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ listingId }),
    }),
  update: (id: string, version: number, body: unknown) =>
    api<Campaign>(`/api/v2/campaigns/${id}`, {
      method: "PATCH",
      headers: { "If-Match": String(version) },
      body: JSON.stringify(body),
    }),
  preview: (id: string, signal?: AbortSignal) =>
    api<{ html: string; text: string }>(`/api/v2/campaigns/${id}/preview`, {
      method: "POST",
      signal,
      body: JSON.stringify({ firstName: "Alex" }),
    }),
  test: (id: string, email: string, version: number) =>
    api(`/api/v2/campaigns/${id}/test-send`, {
      method: "POST",
      body: JSON.stringify({ email, version, clientRequestId: crypto.randomUUID() }),
    }),
  publish: (id: string, version: number, scheduledAt?: string) =>
    api<Campaign>(`/api/v2/campaigns/${id}/publish`, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ version, scheduledAt: scheduledAt || undefined }),
    }),
};
