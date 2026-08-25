import type {
  ListingSourceProvider,
  OneKeyListing,
  OneKeyListingAgent,
  RecipientCandidateResult,
} from "./types.js";

export const fakeOneKeyListing: OneKeyListing = {
  sourceKey: "KEY900000001",
  listingId: "90000001",
  standardStatus: "Active",
  unparsedAddress: "136-20 Roosevelt Ave, Flushing, NY 11354",
  city: "Flushing",
  stateCode: "NY",
  postalCode: "11354",
  county: "Queens",
  propertyType: "Residential",
  propertySubType: "Single Family Residence",
  listPrice: 1250000,
  bedroomsTotal: 4,
  bathroomsTotalInteger: 3,
  livingArea: 2100,
  yearBuilt: 1925,
  publicRemarks: "Bright detached home near transit with a private yard.",
  listAgentFullName: "Fixture Agent",
  listOfficeName: "External Realty",
  modificationTimestamp: "2026-08-22T12:00:00.000Z",
  imageUrls: [],
  raw: { fixture: true },
};

export class FakeOneKeyProvider implements ListingSourceProvider {
  readonly name = "fake";
  async testConnection() {
    return { ok: true as const, provider: this.name };
  }
  async search(input: { query: string; limit: number; offset: number }) {
    if (input.offset > 0) return [];
    const q = input.query.toLowerCase();
    return !q || JSON.stringify(fakeOneKeyListing).toLowerCase().includes(q)
      ? [fakeOneKeyListing].slice(0, input.limit)
      : [];
  }
  async getBySourceKey(sourceKey: string) {
    if (sourceKey !== fakeOneKeyListing.sourceKey) throw new Error("Fixture listing not found");
    return fakeOneKeyListing;
  }
  async getByMLS(listingId: string) {
    if (listingId !== fakeOneKeyListing.listingId) throw new Error("Fixture listing not found");
    return fakeOneKeyListing;
  }
  async getListingAgent(sourceKey: string): Promise<OneKeyListingAgent> {
    if (sourceKey !== fakeOneKeyListing.sourceKey) throw new Error("Fixture listing not found");
    return {
      memberKey: "KEY_FIXTURE_AGENT",
      memberMlsId: "FIXTURE100",
      fullName: "Fixture Agent",
      firstName: "Fixture",
      lastName: "Agent",
      email: "fixture-agent@homixny.com",
      phone: "718-555-0100",
      stateLicense: "10401300000",
      status: "Active",
      officeKey: "KEY_FIXTURE_OFFICE",
      officeName: "Homix Realty",
    };
  }
  async getRecipientCandidates(
    sourceKey: string,
    input: { nearbyZipCount: number; closedMonths: number; limit: number }
  ): Promise<RecipientCandidateResult> {
    return {
      listingKey: sourceKey,
      postalCode: "11354",
      closedMonths: input.closedMonths,
      nearbyZipCount: input.nearbyZipCount,
      excludedOfficeKey: "KEY421354028",
      recipients: [
        {
          memberKey: "KEY_EXTERNAL_AGENT",
          memberMlsId: "EXT100",
          fullName: "External Agent",
          email: "external-agent@example.com",
          officeKey: "KEY_EXTERNAL_OFFICE",
          officeName: "External Realty",
          matchedTransactionSides: 3,
          matchedZipCount: 2,
          nearestDistanceKm: 0,
          matchedSameZip: true,
          representedSeller: true,
          representedBuyer: true,
        },
      ].slice(0, input.limit),
      count: 1,
      truncated: false,
      selectionPolicy: "fixture-recent-closed-both-sides-active-external-valid-email",
      zipScope: [
        { postalCode: "11354", distanceKm: 0, isAnchor: true },
        { postalCode: "11355", distanceKm: 2.1, isAnchor: false },
      ],
    };
  }
  async changes(cursor: string) {
    return {
      sourceKeys: cursor ? [] : [fakeOneKeyListing.sourceKey],
      nextCursor: "1",
      hasMore: false,
    };
  }
}
