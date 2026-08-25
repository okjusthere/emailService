import { config } from "../../config/index.js";
import { DomainError } from "../../shared/errors.js";
import { BboOneKeyProvider } from "./BboOneKeyProvider.js";
import { FakeOneKeyProvider } from "./FakeOneKeyProvider.js";
import type { ListingSourceProvider } from "./types.js";

let override: ListingSourceProvider | undefined;

export function setOneKeyProviderForTests(provider?: ListingSourceProvider) {
  override = provider;
}

export function getOneKeyProvider(): ListingSourceProvider {
  if (override) return override;
  if (config.oneKeyProvider === "fake") return new FakeOneKeyProvider();
  if (config.oneKeyProvider === "bbo")
    return new BboOneKeyProvider(
      config.bboListingApiBaseUrl,
      config.bboMarketingApiKey,
      config.aiRequestTimeoutMs
    );
  throw new DomainError(
    "ONEKEY_DISABLED",
    "OneKey integration is disabled. Existing imported listings remain available.",
    409
  );
}

export type {
  ListingSourceProvider,
  OneKeyListing,
  OneKeyListingAgent,
  RecipientCandidateResult,
} from "./types.js";
