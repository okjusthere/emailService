import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderMessage } from "../../src/email/providers/EmailProvider.js";

const mocks = vi.hoisted(() => ({
  batchSend: vi.fn(),
  emailSend: vi.fn(),
  webhookVerify: vi.fn(),
}));

vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({
    batch: { send: mocks.batchSend },
    emails: { send: mocks.emailSend },
    webhooks: { verify: mocks.webhookVerify },
  })),
}));

import { ResendEmailProvider } from "../../src/email/providers/ResendEmailProvider.js";

const message: ProviderMessage = {
  from: "Homix <listings@example.com>",
  to: "recipient@example.com",
  replyTo: "broker@example.com",
  subject: "Listing",
  html: "<p>Listing</p>",
  text: "Listing",
  headers: { "List-Unsubscribe": "<https://example.com/unsubscribe>" },
  tags: [{ name: "campaign", value: "test" }],
};

describe("ResendEmailProvider", () => {
  beforeEach(() => vi.clearAllMocks());

  it("preserves permissive-batch indexes and reports missing provider results", async () => {
    mocks.batchSend.mockResolvedValue({
      data: {
        data: [{ id: "email-0" }],
        errors: [{ index: 1, message: "invalid recipient" }],
      },
      error: null,
    });
    const provider = new ResendEmailProvider("re_test", "whsec_current");
    await expect(
      provider.sendBatch([message, message, message], { idempotencyKey: "batch-key" })
    ).resolves.toEqual({
      items: [
        { index: 0, accepted: true, providerEmailId: "email-0" },
        { index: 1, accepted: false, code: "validation_error", message: "invalid recipient" },
        {
          index: 2,
          accepted: false,
          code: "missing_provider_result",
          message: "Provider returned no result for this index",
        },
      ],
    });
    expect(mocks.batchSend).toHaveBeenCalledWith(expect.any(Array), {
      idempotencyKey: "batch-key",
      batchValidation: "permissive",
    });
  });

  it("classifies API errors for delivery retry policy", async () => {
    mocks.batchSend.mockResolvedValue({
      data: null,
      error: { message: "rate limited", statusCode: 429, name: "rate_limit_exceeded" },
    });
    const provider = new ResendEmailProvider("re_test", "whsec_current");
    await expect(
      provider.sendBatch([message], { idempotencyKey: "batch-key" })
    ).rejects.toMatchObject({ message: "rate limited", status: 429, code: "rate_limit_exceeded" });
  });

  it("accepts an unexpired previous webhook secret but rejects an expired one", async () => {
    const event = {
      type: "email.delivered",
      created_at: "2026-08-21T12:00:00.000Z",
      data: { email_id: "email-1", to: ["recipient@example.com"] },
    };
    mocks.webhookVerify.mockImplementation(({ webhookSecret }: { webhookSecret: string }) => {
      if (webhookSecret === "whsec_current") throw new Error("bad current signature");
      return event;
    });
    const rotating = new ResendEmailProvider(
      "re_test",
      "whsec_current",
      "whsec_previous",
      "2999-01-01T00:00:00.000Z"
    );
    await expect(
      rotating.verifyWebhook({
        rawBody: JSON.stringify(event),
        headers: {
          "svix-id": "event-1",
          "svix-timestamp": "1",
          "svix-signature": "signature",
        },
      })
    ).resolves.toMatchObject({
      type: "email.delivered",
      emailId: "email-1",
      recipient: "recipient@example.com",
    });

    mocks.webhookVerify.mockImplementation(() => {
      throw new Error("bad signature");
    });
    const expired = new ResendEmailProvider(
      "re_test",
      "whsec_current",
      "whsec_previous",
      "2000-01-01T00:00:00.000Z"
    );
    await expect(
      expired.verifyWebhook({ rawBody: "{}", headers: { "svix-id": "event-2" } })
    ).rejects.toThrow("bad signature");
    expect(mocks.webhookVerify).toHaveBeenCalledTimes(3);
  });

  it("rejects a signed webhook whose payload does not match the provider schema", async () => {
    mocks.webhookVerify.mockReturnValue({ type: "email.delivered", data: null });
    const provider = new ResendEmailProvider("re_test", "whsec_current");
    await expect(
      provider.verifyWebhook({ rawBody: "{}", headers: { "svix-id": "event-3" } })
    ).rejects.toThrow();
  });
});
