import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  user: vi.fn(),
  campaign: vi.fn(),
  existingTest: vi.fn(),
  saveTest: vi.fn(),
  updateCampaign: vi.fn(),
  audit: vi.fn(),
  send: vi.fn(),
}));
vi.mock("../../src/db/prisma.js", () => {
  const db = {
    user: { findUnique: fake.user },
    campaign: { findUnique: fake.campaign, update: fake.updateCampaign },
    testSendRecord: { findUnique: fake.existingTest, upsert: fake.saveTest },
    auditLog: { create: fake.audit },
  };
  return { prisma: { ...db, $transaction: (fn: (tx: unknown) => unknown) => fn(db) } };
});
vi.mock("../../src/email/providers/index.js", () => ({
  getEmailProvider: () => ({ sendSingle: fake.send }),
}));

import { config } from "../../src/config/index.js";
import { testSendCampaign } from "../../src/modules/campaigns/service.js";

const mutableConfig = config as {
  deliveryMode: "disabled" | "sandbox" | "live";
  testAllowlist: string[];
};
const originalMode = mutableConfig.deliveryMode;
const originalAllowlist = mutableConfig.testAllowlist;
const actor = { userId: "portal-user", role: "MARKETER" as const };
const id = "f717651f-27b6-439d-a250-b0057caf63fb";
const email = "agent@example.com";

describe("campaign self-test delivery", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mutableConfig.deliveryMode = "live";
    mutableConfig.testAllowlist = [];
    fake.user.mockResolvedValue({ email, displayName: "Portal Agent" });
    fake.campaign.mockResolvedValue({
      id,
      version: 3,
      sourceApplication: null,
      deletedAt: null,
      subject: "Listing preview",
      templateKey: "BROKER_PERSONAL",
      ctaLabel: "View listing",
      ctaUrl: "https://example.com/listing",
      senderProfile: { fromName: "Homix", fromEmail: "listings@example.com" },
      listing: {
        id: "listing",
        title: "Test listing",
        addressLine1: "123 Main Street",
        city: "Flushing",
        stateCode: "NY",
        postalCode: "11354",
        currency: "USD",
        highlights: [],
        agent: { id: "listing-agent", displayName: "Listing Agent", email: "listing@example.com" },
        assets: [{ kind: "HERO", isEmailSafe: true, publicUrl: "https://example.com/hero.jpg" }],
      },
    });
    fake.send.mockResolvedValue({ accepted: true, providerEmailId: "fake-test-email" });
  });
  afterEach(() => {
    mutableConfig.deliveryMode = originalMode;
    mutableConfig.testAllowlist = originalAllowlist;
  });

  it.each([email, "second-agent@example.net"])(
    "sends a live self-test to %s without manual allowlisting",
    async (recipient) => {
      fake.user.mockResolvedValue({ email: recipient, displayName: "Portal Agent" });
      await expect(
        testSendCampaign(id, ` ${recipient.toUpperCase()} `, 3, "self-test-request", actor)
      ).resolves.toMatchObject({ accepted: true, duplicate: false });
      expect(fake.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: recipient, subject: "[TEST] Listing preview" }),
        expect.objectContaining({ idempotencyKey: expect.stringContaining("/actor/portal-user/") })
      );
      expect(fake.updateCampaign).toHaveBeenCalledWith({
        where: { id },
        data: { lastTestedVersion: 3, lastSuccessfulTestAt: expect.any(Date) },
      });
      expect(fake.saveTest).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ createdByUserId: actor.userId, success: true }),
        })
      );
    }
  );
  it("rejects another recipient even if that address is allowlisted", async () => {
    mutableConfig.testAllowlist = ["other@example.com"];
    await expect(
      testSendCampaign(id, "other@example.com", 3, "self-test-request", actor)
    ).rejects.toMatchObject({ code: "TEST_RECIPIENT_MUST_BE_SELF" });
    expect(fake.send).not.toHaveBeenCalled();
  });
  it("rejects a missing account", async () => {
    fake.user.mockResolvedValue(null);
    await expect(testSendCampaign(id, email, 3, "self-test-request", actor)).rejects.toMatchObject({
      code: "TEST_RECIPIENT_UNAVAILABLE",
    });
    expect(fake.send).not.toHaveBeenCalled();
  });
  it("uses the current account email after an email change", async () => {
    fake.user.mockResolvedValue({ email: "updated@example.com", displayName: "Portal Agent" });
    await expect(testSendCampaign(id, email, 3, "self-test-request", actor)).rejects.toMatchObject({
      code: "TEST_RECIPIENT_MUST_BE_SELF",
    });
    expect(fake.send).not.toHaveBeenCalled();
  });
  it("keeps sandbox self-tests restricted to allowlisted recipients", async () => {
    mutableConfig.deliveryMode = "sandbox";
    await expect(testSendCampaign(id, email, 3, "self-test-request", actor)).rejects.toMatchObject({
      code: "TEST_RECIPIENT_NOT_ALLOWED",
    });
    expect(fake.send).not.toHaveBeenCalled();
    mutableConfig.testAllowlist = [email];
    await expect(testSendCampaign(id, email, 3, "self-test-request", actor)).resolves.toMatchObject(
      {
        accepted: true,
      }
    );
  });
  it("blocks self-tests when delivery is disabled, including allowlisted users", async () => {
    mutableConfig.deliveryMode = "disabled";
    mutableConfig.testAllowlist = [email];
    await expect(testSendCampaign(id, email, 3, "self-test-request", actor)).rejects.toMatchObject({
      code: "DELIVERY_DISABLED",
    });
    expect(fake.send).not.toHaveBeenCalled();
  });
  it("requires the current campaign version", async () => {
    await expect(testSendCampaign(id, email, 2, "self-test-request", actor)).rejects.toMatchObject({
      code: "CAMPAIGN_VERSION_CONFLICT",
    });
    expect(fake.send).not.toHaveBeenCalled();
  });
  it("does not send a duplicate successful request again", async () => {
    fake.existingTest.mockResolvedValue({ success: true, providerEmailId: "previous-email" });
    await expect(testSendCampaign(id, email, 3, "self-test-request", actor)).resolves.toMatchObject(
      {
        accepted: true,
        duplicate: true,
        providerEmailId: "previous-email",
      }
    );
    expect(fake.send).not.toHaveBeenCalled();
  });
  it("does not unlock publishing when the provider rejects the test", async () => {
    fake.send.mockResolvedValue({ accepted: false, message: "Rejected by test provider" });
    await expect(testSendCampaign(id, email, 3, "self-test-request", actor)).rejects.toMatchObject({
      code: "TEST_SEND_FAILED",
    });
    expect(fake.updateCampaign).not.toHaveBeenCalled();
    expect(fake.saveTest).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ success: false }) })
    );
  });
});
