export const TRACKING_CONFIG_TTL_MS = 5 * 60_000;

export interface TrackingObservation {
  id: string;
  revision: number;
  provider: string;
  domain: string;
  providerDomainId: string | null;
  openTrackingEnabled: boolean | null;
  clickTrackingEnabled: boolean | null;
  trackingDomain: string | null;
  trackingVerified: boolean;
  checkedAt: Date | null;
  lastError: string | null;
}

export interface TrackingSnapshot {
  version: 1;
  provider: string;
  domain: string;
  revision: string | null;
  checkedAt: string | null;
  openTrackingEnabled: boolean | null;
  clickTrackingEnabled: boolean | null;
  trackingDomain: string | null;
}

export function unknownTrackingSnapshot(provider: string, domain: string): TrackingSnapshot {
  return {
    version: 1,
    provider,
    domain,
    revision: null,
    checkedAt: null,
    openTrackingEnabled: null,
    clickTrackingEnabled: null,
    trackingDomain: null,
  };
}

export function trackingSnapshotFromObservation(
  observation: TrackingObservation,
  now = new Date()
): TrackingSnapshot {
  const fresh =
    observation.checkedAt &&
    !observation.lastError &&
    now.getTime() - observation.checkedAt.getTime() < TRACKING_CONFIG_TTL_MS &&
    observation.checkedAt.getTime() <= now.getTime();
  const effective = (enabled: boolean | null) =>
    !fresh
      ? null
      : enabled === false
        ? false
        : enabled === true && observation.trackingVerified
          ? true
          : null;
  return {
    version: 1,
    provider: observation.provider,
    domain: observation.domain,
    revision: `${observation.id}:${observation.revision}`,
    checkedAt: observation.checkedAt?.toISOString() ?? null,
    openTrackingEnabled: effective(observation.openTrackingEnabled),
    clickTrackingEnabled: effective(observation.clickTrackingEnabled),
    trackingDomain: observation.trackingDomain,
  };
}

export function parseTrackingSnapshot(value: unknown): TrackingSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const s = value as Record<string, unknown>;
  if (
    s.version !== 1 ||
    typeof s.provider !== "string" ||
    typeof s.domain !== "string" ||
    !(s.openTrackingEnabled === null || typeof s.openTrackingEnabled === "boolean") ||
    !(s.clickTrackingEnabled === null || typeof s.clickTrackingEnabled === "boolean")
  )
    return null;
  return {
    version: 1,
    provider: s.provider,
    domain: s.domain,
    revision: typeof s.revision === "string" ? s.revision : null,
    checkedAt:
      typeof s.checkedAt === "string" && Number.isFinite(Date.parse(s.checkedAt))
        ? s.checkedAt
        : null,
    openTrackingEnabled: s.openTrackingEnabled,
    clickTrackingEnabled: s.clickTrackingEnabled,
    trackingDomain: typeof s.trackingDomain === "string" ? s.trackingDomain : null,
  };
}
