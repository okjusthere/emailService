import { api } from "../lib/api.js";

export type AudienceEstimate = {
  matched: number;
  eligible: number;
  suppressed: number;
  unknownPermission: number;
};

export const contactsApi = {
  estimate: (filter: Record<string, unknown>) =>
    api<AudienceEstimate>("/api/v2/audiences/estimate", {
      method: "POST",
      body: JSON.stringify(filter),
    }),
};
