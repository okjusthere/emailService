import { Resend } from "resend";
import { z } from "zod";
import type {
  EmailProvider,
  ProviderBatchResult,
  ProviderItemResult,
  ProviderMessage,
  ProviderDomainObservation,
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
    private readonly apiKey: string,
    private readonly webhookSecret: string,
    private readonly previousSecret = "",
    private readonly previousExpiresAt = ""
  ) {
    this.client = new Resend(apiKey);
  }

  async getDomainTracking(
    domain: string,
    providerDomainId?: string
  ): Promise<ProviderDomainObservation> {
    // Configuration must never block delivery indefinitely. The sending SDK does
    // not expose an abort signal for its domains methods, so these reads are bounded.
    const signal = AbortSignal.timeout(8_000);
    const read = async (path: string): Promise<unknown> => {
      const response = await fetch(`https://api.resend.com${path}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal,
      });
      if (!response.ok) throw new Error(`Provider domain read failed (${response.status})`);
      return response.json();
    };
    let id = providerDomainId;
    if (!id) {
      let after: string | undefined;
      for (let page = 0; page < 20 && !id; page += 1) {
        const list = z
          .object({
            data: z.array(z.object({ id: z.string(), name: z.string() })),
            has_more: z.boolean().optional(),
          })
          .parse(
            await read(`/domains?limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`)
          );
        id = list.data.find((entry) => entry.name.toLowerCase() === domain.toLowerCase())?.id;
        if (!list.has_more || list.data.length === 0) break;
        after = list.data.at(-1)!.id;
      }
    }
    if (!id) throw new Error("Sending domain was not found at the provider");
    const data = z
      .object({
        id: z.string(),
        name: z.string(),
        open_tracking: z.boolean().optional(),
        click_tracking: z.boolean().optional(),
        tracking_subdomain: z.string().nullish(),
        records: z
          .array(z.object({ record: z.string(), name: z.string(), status: z.string() }))
          .default([]),
      })
      .parse(await read(`/domains/${encodeURIComponent(id)}`));
    if (data.name.toLowerCase() !== domain.toLowerCase())
      throw new Error("Provider domain does not match the sending domain");
    const trackingDomain = data.tracking_subdomain
      ? `${data.tracking_subdomain}.${data.name}`.toLowerCase()
      : null;
    const trackingRecord = data.records.find(
      (record) => record.record === "Tracking" && record.name.toLowerCase() === trackingDomain
    );
    // Resend may require CAA authorization before it can issue tracking TLS.
    const trackingCaaVerified = data.records
      .filter((record) => record.record === "TrackingCAA")
      .every((record) => record.status === "verified");
    return {
      providerDomainId: data.id,
      domain: data.name.toLowerCase(),
      openTrackingEnabled: data.open_tracking ?? null,
      clickTrackingEnabled: data.click_tracking ?? null,
      trackingDomain,
      trackingVerified: trackingRecord?.status === "verified" && trackingCaaVerified,
    };
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
