import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.js";
import { getEmailProvider } from "../../email/providers/index.js";
import { sanitizeErrorMessage } from "../../shared/normalize.js";
import {
  TRACKING_CONFIG_TTL_MS,
  trackingSnapshotFromObservation,
  unknownTrackingSnapshot,
  type TrackingSnapshot,
} from "./domain.js";

// Longer than the provider's 8-second read deadline. A token fences late completions.
const REFRESH_LEASE_MS = 30_000;

/** Read-only provider sync; the operator owns domain/DNS configuration changes. */
export async function observeDomainTracking(
  provider: string,
  domain: string,
  force = false
): Promise<TrackingSnapshot> {
  domain = domain.trim().toLowerCase();
  const now = new Date();
  const api = getEmailProvider();
  if (!api.getDomainTracking) return unknownTrackingSnapshot(provider, domain);
  const where = { provider_domain: { provider, domain } };
  let record = await prisma.providerDomainTracking.upsert({
    where,
    create: { provider, domain },
    update: {},
  });
  // A forced request bypasses cached observations, never another request's lease.
  // Report unknown while refreshing so a config change is not presented as verified.
  if (record.refreshLeaseUntil && record.refreshLeaseUntil > now)
    return unknownTrackingSnapshot(provider, domain);
  const retryAfter = new Date(now.getTime() - (record.lastError ? 60_000 : TRACKING_CONFIG_TTL_MS));
  if (!force && !record.refreshToken && record.lastAttemptAt && record.lastAttemptAt > retryAfter)
    return trackingSnapshotFromObservation(record, now);
  const refreshToken = randomUUID();
  const claimed = await prisma.providerDomainTracking.updateMany({
    where: {
      id: record.id,
      lastAttemptAt: record.lastAttemptAt,
      OR: [{ refreshLeaseUntil: null }, { refreshLeaseUntil: { lte: now } }],
    },
    data: {
      lastAttemptAt: now,
      refreshToken,
      refreshLeaseUntil: new Date(now.getTime() + REFRESH_LEASE_MS),
    },
  });
  if (!claimed.count) return unknownTrackingSnapshot(provider, domain);
  try {
    const observed = await api.getDomainTracking(domain, record.providerDomainId ?? undefined);
    const changed =
      record.openTrackingEnabled !== observed.openTrackingEnabled ||
      record.clickTrackingEnabled !== observed.clickTrackingEnabled ||
      record.trackingDomain !== observed.trackingDomain ||
      record.trackingVerified !== observed.trackingVerified;
    const checkedAt = new Date();
    const committed = await prisma.$transaction(async (tx) => {
      const updated = await tx.providerDomainTracking.updateMany({
        where: { id: record.id, refreshToken, refreshLeaseUntil: { gt: checkedAt } },
        data: {
          providerDomainId: observed.providerDomainId,
          openTrackingEnabled: observed.openTrackingEnabled,
          clickTrackingEnabled: observed.clickTrackingEnabled,
          trackingDomain: observed.trackingDomain,
          trackingVerified: observed.trackingVerified,
          revision: changed ? { increment: 1 } : undefined,
          checkedAt,
          verifiedAt: observed.trackingVerified
            ? changed
              ? checkedAt
              : (record.verifiedAt ?? checkedAt)
            : null,
          lastError: null,
          refreshToken: null,
          refreshLeaseUntil: null,
        },
      });
      if (!updated.count) return null;
      // Keep the observation row locked until mirrors commit. A late owner must
      // never overwrite either the domain record or its senders after a new lease.
      await tx.senderProfile.updateMany({
        where: { provider, domain: { equals: domain, mode: "insensitive" } },
        data: {
          openTrackingEnabled: observed.openTrackingEnabled === true && observed.trackingVerified,
          clickTrackingEnabled: observed.clickTrackingEnabled === true && observed.trackingVerified,
        },
      });
      return tx.providerDomainTracking.findUniqueOrThrow({ where });
    });
    if (!committed) return unknownTrackingSnapshot(provider, domain);
    record = committed;
  } catch (error) {
    const completedAt = new Date();
    const failed = await prisma.providerDomainTracking.updateMany({
      where: { id: record.id, refreshToken, refreshLeaseUntil: { gt: completedAt } },
      data: {
        lastError: sanitizeErrorMessage(error),
        refreshToken: null,
        refreshLeaseUntil: null,
      },
    });
    if (!failed.count) return unknownTrackingSnapshot(provider, domain);
    record = await prisma.providerDomainTracking.findUniqueOrThrow({ where });
  }
  return trackingSnapshotFromObservation(record);
}
