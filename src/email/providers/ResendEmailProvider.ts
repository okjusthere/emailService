import { Resend } from "resend";
import { z } from "zod";
import type {
  EmailProvider,
  ProviderBatchResult,
  ProviderItemResult,
  ProviderMessage,
  VerifiedWebhookEvent,
} from "./EmailProvider.js";

const webhookSchema = z
  .object({
    type: z.string(),
    created_at: z.iso.datetime().optional(),
    data: z
      .object({
        email_id: z.string().optional(),
        to: z.union([z.string(), z.array(z.string())]).optional(),
        created_at: z.iso.datetime().optional(),
      })
      .passthrough(),
  })
  .passthrough();

function mapMessage(message: ProviderMessage) {
  return {
    from: message.from,
    to: message.to,
    replyTo: message.replyTo,
    subject: message.subject,
    html: message.html,
    text: message.text,
    headers: message.headers,
    tags: message.tags,
  };
}

export class ResendEmailProvider implements EmailProvider {
  private readonly client: Resend;
  constructor(
    apiKey: string,
    private readonly webhookSecret: string,
    private readonly previousSecret = "",
    private readonly previousExpiresAt = ""
  ) {
    this.client = new Resend(apiKey);
  }

  async sendBatch(
    messages: ProviderMessage[],
    options: { idempotencyKey: string }
  ): Promise<ProviderBatchResult> {
    if (messages.length < 1 || messages.length > 100)
      throw new Error("Resend batch size must be 1–100");
    const response = await this.client.batch.send(messages.map(mapMessage), {
      idempotencyKey: options.idempotencyKey,
      batchValidation: "permissive",
    });
    if (response.error)
      throw Object.assign(new Error(response.error.message), {
        status: response.error.statusCode,
        code: response.error.name,
      });
    const failures = new Map(
      (response.data.errors ?? []).map((error) => [error.index, error.message])
    );
    let acceptedCursor = 0;
    const items = messages.map((_message, index): ProviderItemResult => {
      const failure = failures.get(index);
      if (failure) return { index, accepted: false, code: "validation_error", message: failure };
      const result = response.data.data[acceptedCursor++];
      return result
        ? { index, accepted: true, providerEmailId: result.id }
        : {
            index,
            accepted: false,
            code: "missing_provider_result",
            message: "Provider returned no result for this index",
          };
    });
    return { items };
  }

  async sendSingle(
    message: ProviderMessage,
    options: { idempotencyKey: string }
  ): Promise<ProviderItemResult> {
    const response = await this.client.emails.send(mapMessage(message), {
      idempotencyKey: options.idempotencyKey,
    });
    if (response.error)
      return {
        index: 0,
        accepted: false,
        code: response.error.name,
        message: response.error.message,
      };
    return { index: 0, accepted: true, providerEmailId: response.data.id };
  }

  async verifyWebhook(input: {
    rawBody: string;
    headers: Record<string, string | undefined>;
  }): Promise<VerifiedWebhookEvent> {
    const headers = {
      id: input.headers["svix-id"] ?? "",
      timestamp: input.headers["svix-timestamp"] ?? "",
      signature: input.headers["svix-signature"] ?? "",
    };
    let verified: unknown;
    try {
      verified = this.client.webhooks.verify({
        payload: input.rawBody,
        headers,
        webhookSecret: this.webhookSecret,
      });
    } catch (currentError) {
      const previousValid =
        this.previousSecret &&
        this.previousExpiresAt &&
        new Date(this.previousExpiresAt) > new Date();
      if (!previousValid) throw currentError;
      verified = this.client.webhooks.verify({
        payload: input.rawBody,
        headers,
        webhookSecret: this.previousSecret,
      });
    }
    const event = webhookSchema.parse(verified);
    const recipients = event.data.to;
    return {
      type: event.type,
      createdAt: new Date(event.created_at ?? event.data.created_at ?? Date.now()),
      emailId: event.data.email_id,
      recipient: Array.isArray(recipients) ? recipients[0] : recipients,
      payload: event as Record<string, unknown>,
    };
  }
}
