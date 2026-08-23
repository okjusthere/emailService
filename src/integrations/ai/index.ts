import { config } from "../../config/index.js";
import { DomainError } from "../../shared/errors.js";
import { FakeAiProvider } from "./FakeAiProvider.js";
import { OpenAiCopyProvider } from "./OpenAiCopyProvider.js";
import type { AiCopyProvider } from "./types.js";

let override: AiCopyProvider | undefined;

export function setAiProviderForTests(provider?: AiCopyProvider) {
  override = provider;
}

export function getAiProvider(): AiCopyProvider {
  if (override) return override;
  if (config.aiProvider === "fake") return new FakeAiProvider();
  if (config.aiProvider === "openai")
    return new OpenAiCopyProvider(
      config.openAiApiKey,
      config.openAiModel,
      config.aiRequestTimeoutMs
    );
  throw new DomainError(
    "AI_DISABLED",
    "AI assistance is disabled. Existing deterministic editing and templates remain available.",
    409
  );
}

export type { AiCopyProvider, AiTone, CampaignCopyProposal, ListingCopyProposal } from "./types.js";
