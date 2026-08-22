import type { Prisma } from "@prisma/client";
import { PermissionBasis } from "@prisma/client";
import type { AudienceFilter } from "../../shared/schemas.js";

export function compileAudienceWhere(
  filter: AudienceFilter,
  livePolicy = true
): Prisma.ContactWhereInput {
  const and: Prisma.ContactWhereInput[] = [
    { status: "ACTIVE", archivedAt: null },
    { NOT: { emailNormalized: { in: [] } } },
  ];
  if (filter.contactTypes?.length) and.push({ contactType: { in: filter.contactTypes } });
  if (filter.sourceTypes?.length) and.push({ sourceType: { in: filter.sourceTypes } });
  if (filter.permissionBases?.length) and.push({ permissionBasis: { in: filter.permissionBases } });
  if ((filter.requireKnownPermissionBasis ?? true) && livePolicy)
    and.push({ permissionBasis: { not: PermissionBasis.UNKNOWN } });
  if (filter.marketIdsAny?.length)
    and.push({ markets: { some: { marketId: { in: filter.marketIdsAny } } } });
  if (filter.propertyInterestIdsAny?.length)
    and.push({
      propertyInterests: { some: { propertyInterestId: { in: filter.propertyInterestIdsAny } } },
    });
  if (filter.tagIdsAny?.length) and.push({ tags: { some: { tagId: { in: filter.tagIdsAny } } } });
  for (const tagId of filter.tagIdsAll ?? []) and.push({ tags: { some: { tagId } } });
  if (filter.excludeTagIds?.length)
    and.push({ tags: { none: { tagId: { in: filter.excludeTagIds } } } });
  if (filter.includeContactIds?.length) and.push({ id: { in: filter.includeContactIds } });
  if (filter.excludeContactIds?.length) and.push({ id: { notIn: filter.excludeContactIds } });
  if (filter.engagedWithinDays) {
    and.push({
      lastEngagedAt: { gte: new Date(Date.now() - filter.engagedWithinDays * 86_400_000) },
    });
  }
  if (filter.createdAfter) and.push({ createdAt: { gte: new Date(filter.createdAfter) } });
  return { AND: and };
}
