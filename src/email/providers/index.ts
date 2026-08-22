import { config } from "../../config/index.js";
import type { EmailProvider } from "./EmailProvider.js";
import { FakeEmailProvider } from "./FakeEmailProvider.js";
import { ResendEmailProvider } from "./ResendEmailProvider.js";

let provider: EmailProvider | undefined;

export function getEmailProvider(): EmailProvider {
  provider ??=
    config.emailProvider === "fake"
      ? new FakeEmailProvider()
      : new ResendEmailProvider(
          config.resendApiKey,
          config.resendWebhookSecret,
          config.resendWebhookPreviousSecret,
          config.resendWebhookPreviousSecretExpiresAt
        );
  return provider;
}

export function setEmailProviderForTest(value: EmailProvider | undefined): void {
  provider = value;
}
