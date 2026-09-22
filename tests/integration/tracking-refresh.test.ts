import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/db/prisma.js";
import { FakeEmailProvider } from "../../src/email/providers/FakeEmailProvider.js";
import type { ProviderDomainObservation } from "../../src/email/providers/EmailProvider.js";
import { setEmailProviderForTest } from "../../src/email/providers/index.js";
import { observeDomainTracking } from "../../src/modules/tracking/service.js";

const domains: string[] = [];
const senderIds: string[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function fixture() {
  const domain = `tracking-${randomUUID()}.example.com`;
  domains.push(domain);
  const sender = await prisma.senderProfile.create({
    data: {
      name: "Tracking lease test",
      fromName: "Tracking test",
      domain,
      fromEmail: `sender@${domain}`,
      fromEmailNormalized: `sender@${domain}`,
      clickTrackingEnabled: true,
    },
  });
  senderIds.push(sender.id);
  const record = await prisma.providerDomainTracking.create({
    data: {
      provider: "resend",
      domain,
      providerDomainId: randomUUID(),
      openTrackingEnabled: false,
      clickTrackingEnabled: true,
      trackingDomain: `links.${domain}`,
      trackingVerified: true,
      checkedAt: new Date(),
      lastAttemptAt: new Date(),
    },
  });
  const observation = (enabled: boolean): ProviderDomainObservation => ({
    providerDomainId: record.providerDomainId!,
    domain,
    openTrackingEnabled: false,
    clickTrackingEnabled: enabled,
    trackingDomain: `links.${domain}`,
    trackingVerified: true,
  });
  return { domain, sender, record, observation };
}

class TrackingProvider extends FakeEmailProvider {
  constructor(readonly getDomainTracking: (domain: string) => Promise<ProviderDomainObservation>) {
    super();
  }
}

afterEach(() => {
  setEmailProviderForTest(undefined);
});
afterAll(async () => {
  await prisma.senderProfile.deleteMany({ where: { id: { in: senderIds } } });
  await prisma.providerDomainTracking.deleteMany({ where: { domain: { in: domains } } });
  await prisma.$disconnect();
});

describe("domain tracking refresh leases", () => {
  it("force bypasses the cache but cannot overlap an active lease or claim fresh verification", async () => {
    const { domain, record, observation } = await fixture();
    const started = deferred<void>();
    const pending = deferred<ProviderDomainObservation>();
    const read = vi.fn(async () => {
      started.resolve();
      return pending.promise;
    });
    setEmailProviderForTest(new TrackingProvider(read));
    const first = observeDomainTracking("resend", domain, true);
    await started.promise;
    try {
      const claimed = await prisma.providerDomainTracking.findUniqueOrThrow({
        where: { id: record.id },
      });
      expect(claimed.refreshToken).toMatch(/^[0-9a-f-]{36}$/);
      expect(claimed.refreshLeaseUntil!.getTime() - claimed.lastAttemptAt!.getTime()).toBe(30_000);
      const [forcedBusy, regularBusy] = await Promise.all([
        observeDomainTracking("resend", domain, true),
        observeDomainTracking("resend", domain),
      ]);
      expect(forcedBusy).toMatchObject({
        clickTrackingEnabled: null,
        revision: null,
        checkedAt: null,
      });
      expect(regularBusy.clickTrackingEnabled).toBeNull();
      expect(read).toHaveBeenCalledTimes(1);
    } finally {
      pending.resolve(observation(true));
    }
    expect((await first).clickTrackingEnabled).toBe(true);
    const completed = await prisma.providerDomainTracking.findUniqueOrThrow({
      where: { id: record.id },
    });
    expect(completed.refreshToken).toBeNull();
    expect(completed.refreshLeaseUntil).toBeNull();
    await observeDomainTracking("resend", domain);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("an expired owner's late success cannot overwrite the new config or sender mirrors", async () => {
    const { domain, sender, record, observation } = await fixture();
    const started = deferred<void>();
    const pending = deferred<ProviderDomainObservation>();
    const read = vi
      .fn()
      .mockImplementationOnce(async () => {
        started.resolve();
        return pending.promise;
      })
      .mockResolvedValue(observation(false));
    setEmailProviderForTest(new TrackingProvider(read));
    const first = observeDomainTracking("resend", domain, true);
    await started.promise;
    await prisma.providerDomainTracking.update({
      where: { id: record.id },
      data: { refreshLeaseUntil: new Date(Date.now() - 1000) },
    });
    try {
      expect((await observeDomainTracking("resend", domain)).clickTrackingEnabled).toBe(false);
    } finally {
      pending.resolve(observation(true));
    }
    expect((await first).clickTrackingEnabled).toBeNull();
    const [current, mirror] = await Promise.all([
      prisma.providerDomainTracking.findUniqueOrThrow({ where: { id: record.id } }),
      prisma.senderProfile.findUniqueOrThrow({ where: { id: sender.id } }),
    ]);
    expect(current).toMatchObject({
      clickTrackingEnabled: false,
      revision: 2,
      lastError: null,
      refreshToken: null,
      refreshLeaseUntil: null,
    });
    expect(mirror.clickTrackingEnabled).toBe(false);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("an expired owner's late error cannot poison a newer successful observation", async () => {
    const { domain, record, observation } = await fixture();
    const started = deferred<void>();
    const pending = deferred<ProviderDomainObservation>();
    const read = vi
      .fn()
      .mockImplementationOnce(async () => {
        started.resolve();
        return pending.promise;
      })
      .mockResolvedValue(observation(false));
    setEmailProviderForTest(new TrackingProvider(read));
    const first = observeDomainTracking("resend", domain, true);
    await started.promise;
    await prisma.providerDomainTracking.update({
      where: { id: record.id },
      data: { refreshLeaseUntil: new Date(Date.now() - 1000) },
    });
    try {
      expect((await observeDomainTracking("resend", domain, true)).clickTrackingEnabled).toBe(
        false
      );
    } finally {
      pending.reject(new Error("Old provider request timed out"));
    }
    expect((await first).clickTrackingEnabled).toBeNull();
    const current = await prisma.providerDomainTracking.findUniqueOrThrow({
      where: { id: record.id },
    });
    expect(current).toMatchObject({
      clickTrackingEnabled: false,
      lastError: null,
      refreshToken: null,
      refreshLeaseUntil: null,
    });
    expect((await observeDomainTracking("resend", domain)).clickTrackingEnabled).toBe(false);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("a provider outage yields unknown coverage, clears its lease, and respects retry backoff", async () => {
    const { domain, record, observation } = await fixture();
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error("Provider unavailable"))
      .mockResolvedValue(observation(false));
    setEmailProviderForTest(new TrackingProvider(read));
    expect((await observeDomainTracking("resend", domain, true)).clickTrackingEnabled).toBeNull();
    const failed = await prisma.providerDomainTracking.findUniqueOrThrow({
      where: { id: record.id },
    });
    expect(failed).toMatchObject({
      lastError: "Provider unavailable",
      refreshToken: null,
      refreshLeaseUntil: null,
    });
    expect((await observeDomainTracking("resend", domain)).clickTrackingEnabled).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
    expect((await observeDomainTracking("resend", domain, true)).clickTrackingEnabled).toBe(false);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
