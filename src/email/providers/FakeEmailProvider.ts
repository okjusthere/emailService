import { createHash } from "node:crypto";
import type {
  EmailProvider,
  ProviderBatchResult,
  ProviderItemResult,
  ProviderMessage,
  VerifiedWebhookEvent,
} from "./EmailProvider.js";

export class FakeEmailProvider implements EmailProvider {
  readonly outbound: Array<{ messages: ProviderMessage[]; idempotencyKey: string }> = [];
  mode: "accepted" | "partial" | "temporary" | "permanent" | "uncertain" = "accepted";

  async sendBatch(
    messages: ProviderMessage[],
    options: { idempotencyKey: string }
  ): Promise<ProviderBatchResult> {
    if (messages.length > 100) throw new Error("Batch exceeds provider maximum");
    this.outbound.push({
      messages: structuredClone(messages),
      idempotencyKey: options.idempotencyKey,
    });
    if (this.mode === "temporary")
      throw Object.assign(new Error("Temporary fake provider failure"), {
        status: 429,
        code: "rate_limit_exceeded",
      });
    if (this.mode === "uncertain")
      throw Object.assign(new Error("Provider timeout after submit"), {
        timedOutAfterSubmit: true,
      });
    return { items: messages.map((_message, index) => this.result(index, options.idempotencyKey)) };
  }

  async sendSingle(
    message: ProviderMessage,
    options: { idempotencyKey: string }
  ): Promise<ProviderItemResult> {
    return (
      (await this.sendBatch([message], options)).items[0] ?? {
        index: 0,
        accepted: false,
        code: "empty_result",
      }
    );
  }

  async verifyWebhook(input: {
    rawBody: string;
    headers: Record<string, string | undefined>;
  }): Promise<VerifiedWebhookEvent> {
    if (input.headers["svix-signature"] !== "fake-valid") throw new Error("Invalid signature");
    const payload = JSON.parse(input.rawBody) as Record<string, unknown>;
    return {
      type: String(payload.type ?? "unknown"),
      createdAt: new Date(String(payload.created_at ?? new Date().toISOString())),
      emailId: typeof payload.email_id === "string" ? payload.email_id : undefined,
      recipient: typeof payload.recipient === "string" ? payload.recipient : undefined,
      payload,
    };
  }

  private result(index: number, key: string): ProviderItemResult {
    if (this.mode === "permanent")
      return {
        index,
        accepted: false,
        code: "invalid_parameter",
        message: "Permanent fake failure",
      };
    if (this.mode === "partial" && index % 2 === 1)
      return {
        index,
        accepted: false,
        code: "invalid_parameter",
        message: "Partial fake rejection",
      };
    return {
      index,
      accepted: true,
      providerEmailId: `fake_${createHash("sha256").update(`${key}:${index}`).digest("hex").slice(0, 24)}`,
    };
  }
}
