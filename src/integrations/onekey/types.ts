export interface OneKeyListing {
  sourceKey: string;
  listingId?: string;
  standardStatus?: string;
  unparsedAddress: string;
  city: string;
  stateCode: string;
  postalCode: string;
  county?: string;
  propertyType?: string;
  propertySubType?: string;
  listPrice?: number;
  bedroomsTotal?: number;
  bathroomsTotalInteger?: number;
  livingArea?: number;
  yearBuilt?: number;
  publicRemarks?: string;
  listAgentFullName?: string;
  listOfficeName?: string;
  modificationTimestamp?: string;
  imageUrls: string[];
  raw: Record<string, unknown>;
}

export interface OneKeyRecipientCandidate {
  memberKey: string;
  memberMlsId?: string;
  fullName?: string;
  email: string;
  officeKey: string;
  officeName?: string;
  matchedTransactionSides: number;
  matchedZipCount: number;
  nearestDistanceKm?: number;
  matchedSameZip: boolean;
  representedSeller: boolean;
  representedBuyer: boolean;
}

export interface OneKeyListingAgent {
  memberKey: string;
  memberMlsId?: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  email: string;
  mobilePhone?: string;
  directPhone?: string;
  phone?: string;
  stateLicense?: string;
  status?: string;
  headshotUrl?: string;
  officeKey?: string;
  officeName?: string;
}

export interface RecipientCandidateResult {
  listingKey: string;
  postalCode: string;
  closedMonths: number;
  nearbyZipCount: number;
  excludedOfficeKey: string;
  recipients: OneKeyRecipientCandidate[];
  count: number;
  truncated: boolean;
  selectionPolicy: string;
  zipScope: Array<{ postalCode: string; distanceKm: number; isAnchor: boolean }>;
}

export interface OneKeyChangePage {
  sourceKeys: string[];
  nextCursor: string;
  hasMore: boolean;
}

export interface ListingSourceProvider {
  readonly name: string;
  testConnection(): Promise<{ ok: true; provider: string }>;
  search(input: { query: string; limit: number; offset: number }): Promise<OneKeyListing[]>;
  getBySourceKey(sourceKey: string): Promise<OneKeyListing>;
  getByMLS(listingId: string): Promise<OneKeyListing>;
  getListingAgent(sourceKey: string): Promise<OneKeyListingAgent>;
  getRecipientCandidates(
    sourceKey: string,
    input: { nearbyZipCount: number; closedMonths: number; limit: number }
  ): Promise<RecipientCandidateResult>;
  changes?(cursor: string, limit: number): Promise<OneKeyChangePage>;
}
