export interface ProviderMessage {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  tags: Array<{ name: string; value: string }>;
}

export interface ProviderItemResult {
  index: number;
  accepted: boolean;
  providerEmailId?: string;
  code?: string;
  message?: string;
}
export interface ProviderBatchResult {
  items: ProviderItemResult[];
  providerRequestId?: string;
}
export interface VerifiedWebhookEvent {
  type: string;
  createdAt: Date;
  emailId?: string;
  recipient?: string;
  payload: Record<string, unknown>;
}

export interface EmailProvider {
  sendBatch(
    messages: ProviderMessage[],
    options: { idempotencyKey: string }
  ): Promise<ProviderBatchResult>;
  sendSingle(
    message: ProviderMessage,
    options: { idempotencyKey: string }
  ): Promise<ProviderItemResult>;
  verifyWebhook(input: {
    rawBody: string;
    headers: Record<string, string | undefined>;
  }): Promise<VerifiedWebhookEvent>;
}
