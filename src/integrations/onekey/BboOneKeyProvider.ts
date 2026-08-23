import { z } from "zod";
import { DomainError } from "../../shared/errors.js";
import { normalizeOneKeyListing } from "./normalize.js";
import type { ListingSourceProvider, OneKeyChangePage, RecipientCandidateResult } from "./types.js";

const recipientResultSchema = z.object({
  listingKey: z.string(),
  postalCode: z.string(),
  closedMonths: z.number().int(),
  nearbyZipCount: z.number().int(),
  excludedOfficeKey: z.string(),
  recipients: z.array(
    z.object({
      memberKey: z.string(),
      memberMlsId: z.string().optional(),
      fullName: z.string().optional(),
      email: z.email(),
      officeKey: z.string(),
      officeName: z.string().optional(),
      matchedTransactionSides: z.number().int(),
      matchedZipCount: z.number().int(),
      nearestDistanceKm: z.number().optional(),
      matchedSameZip: z.boolean(),
      representedSeller: z.boolean(),
      representedBuyer: z.boolean(),
    })
  ),
  count: z.number().int(),
  truncated: z.boolean(),
  selectionPolicy: z.string(),
  zipScope: z.array(
    z.object({ postalCode: z.string(), distanceKm: z.number(), isAnchor: z.boolean() })
  ),
});

export class BboOneKeyProvider implements ListingSourceProvider {
  readonly name = "bbo";

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly timeoutMs: number
  ) {}

  private async request(path: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 404)
          throw new DomainError("ONEKEY_LISTING_NOT_FOUND", "OneKey listing not found.", 404);
        throw new DomainError(
          "ONEKEY_PROVIDER_UNAVAILABLE",
          "The BBO listing-data service is temporarily unavailable.",
          502
        );
      }
      return response.json();
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        "ONEKEY_PROVIDER_UNAVAILABLE",
        "The BBO listing-data service is temporarily unavailable.",
        502
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async testConnection() {
    await this.request("/listings/search?limit=1");
    return { ok: true as const, provider: this.name };
  }

  async search(input: { query: string; limit: number; offset: number }) {
    const params = new URLSearchParams({
      q: input.query,
      limit: String(input.limit),
      offset: String(input.offset),
      sort: "newest",
    });
    const payload = z
      .object({ items: z.array(z.unknown()) })
      .parse(await this.request(`/listings/search?${params}`));
    return payload.items.map(normalizeOneKeyListing);
  }

  async getBySourceKey(sourceKey: string) {
    const payload = z
      .object({ listing: z.unknown() })
      .parse(await this.request(`/listings/by-key/${encodeURIComponent(sourceKey)}`));
    return normalizeOneKeyListing(payload.listing);
  }

  async getByMLS(listingId: string) {
    const payload = z
      .object({ listing: z.unknown() })
      .parse(await this.request(`/listings/${encodeURIComponent(listingId)}`));
    return normalizeOneKeyListing(payload.listing);
  }

  async getRecipientCandidates(
    sourceKey: string,
    input: { nearbyZipCount: number; closedMonths: number; limit: number }
  ): Promise<RecipientCandidateResult> {
    const params = new URLSearchParams({
      nearbyZipCount: String(input.nearbyZipCount),
      closedMonths: String(input.closedMonths),
      limit: String(input.limit),
    });
    return recipientResultSchema.parse(
      await this.request(
        `/marketing/listings/${encodeURIComponent(sourceKey)}/recipients?${params}`
      )
    );
  }

  async changes(cursor: string, limit: number): Promise<OneKeyChangePage> {
    const payload = z
      .object({
        events: z.array(z.object({ listingKey: z.string() }).passthrough()),
        nextCursor: z.union([z.number(), z.string()]),
        hasMore: z.boolean(),
      })
      .parse(
        await this.request(`/events?since=${encodeURIComponent(cursor || "0")}&limit=${limit}`)
      );
    return {
      sourceKeys: [...new Set(payload.events.map((event) => event.listingKey))],
      nextCursor: String(payload.nextCursor),
      hasMore: payload.hasMore,
    };
  }
}
