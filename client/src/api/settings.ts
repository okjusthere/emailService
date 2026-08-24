import type { ListResponse } from "../app/types.js";
import { api } from "../lib/api.js";

export const settingsApi = {
  agents: () =>
    api<ListResponse<{ id: string; displayName: string; isActive: boolean }>>(
      "/api/v2/agents?limit=100"
    ),
  senders: () =>
    api<ListResponse<{ id: string; name: string; fromEmail: string; verificationStatus: string }>>(
      "/api/v2/sender-profiles"
    ),
};
