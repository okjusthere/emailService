import type { PrismaClient, PropertyType } from "@prisma/client";

const propertyInterests: Array<{ name: string; slug: string; propertyType: PropertyType }> = [
  { name: "Office", slug: "office", propertyType: "OFFICE" },
  { name: "Retail", slug: "retail", propertyType: "RETAIL" },
  { name: "Industrial", slug: "industrial", propertyType: "INDUSTRIAL" },
  { name: "Multifamily", slug: "multifamily", propertyType: "MULTIFAMILY" },
  { name: "Land", slug: "land", propertyType: "LAND" },
  { name: "Mixed Use", slug: "mixed-use", propertyType: "MIXED_USE" },
  { name: "Hospitality", slug: "hospitality", propertyType: "HOSPITALITY" },
  { name: "Special Purpose", slug: "special-purpose", propertyType: "SPECIAL_PURPOSE" },
  { name: "Business", slug: "business", propertyType: "BUSINESS" },
  { name: "Residential", slug: "residential", propertyType: "RESIDENTIAL" },
];

const markets = [
  { name: "Long Island", slug: "long-island", type: "REGION" as const },
  { name: "Nassau County", slug: "nassau-county", type: "COUNTY" as const, stateCode: "NY" },
  { name: "Suffolk County", slug: "suffolk-county", type: "COUNTY" as const, stateCode: "NY" },
  { name: "Queens", slug: "queens", type: "COUNTY" as const, stateCode: "NY" },
  { name: "Brooklyn", slug: "brooklyn", type: "COUNTY" as const, stateCode: "NY" },
  { name: "Manhattan", slug: "manhattan", type: "COUNTY" as const, stateCode: "NY" },
  { name: "New Jersey", slug: "new-jersey", type: "STATE" as const, stateCode: "NJ" },
];

export async function seedDatabase(prisma: PrismaClient): Promise<void> {
  for (const item of propertyInterests)
    await prisma.propertyInterest.upsert({
      where: { slug: item.slug },
      create: item,
      update: { name: item.name, propertyType: item.propertyType, isActive: true },
    });
  for (const item of markets)
    await prisma.market.upsert({
      where: { slug: item.slug },
      create: item,
      update: { name: item.name, type: item.type, stateCode: item.stateCode, isActive: true },
    });
  for (const name of ["Past Client", "Broker", "Investor", "1031", "High Priority"]) {
    const normalizedName = name.toLowerCase();
    await prisma.tag.upsert({
      where: { normalizedName },
      create: { name, normalizedName, color: name === "High Priority" ? "#b85e35" : "#64748b" },
      update: { name, isActive: true },
    });
  }
  if ((await prisma.senderProfile.count()) === 0) {
    await prisma.senderProfile.create({
      data: {
        name: "Homix Listings",
        fromName: "Homix Realty",
        fromEmail: "listings@listings.homixny.com",
        fromEmailNormalized: "listings@listings.homixny.com",
        domain: "listings.homixny.com",
        verificationStatus: "UNVERIFIED",
        isDefault: true,
      },
    });
  }
  await prisma.systemSetting.upsert({
    where: { key: "GLOBAL_SEND_PAUSED" },
    create: { key: "GLOBAL_SEND_PAUSED", value: true },
    update: {},
  });
  await prisma.systemSetting.upsert({
    where: { key: "COMPANY" },
    create: { key: "COMPANY", value: { name: "Homix Realty", postalAddressConfigured: false } },
    update: {},
  });
  await prisma.systemSetting.upsert({
    where: { key: "RECOVERY_GUARD" },
    create: {
      key: "RECOVERY_GUARD",
      value: {
        required: true,
        reason: "Default safe state; reconcile before enabling live delivery",
      },
    },
    update: {},
  });
  await prisma.systemSetting.upsert({
    where: { key: "DELIVERABILITY_THRESHOLDS" },
    create: {
      key: "DELIVERABILITY_THRESHOLDS",
      value: { minSampleSize: 100, complaintRate: 0.001, bounceRate: 0.05 },
    },
    update: {},
  });
  await prisma.job.upsert({
    where: { uniqueKey: "CLEANUP_EXPIRED_DATA/bootstrap" },
    create: {
      type: "CLEANUP_EXPIRED_DATA",
      uniqueKey: "CLEANUP_EXPIRED_DATA/bootstrap",
      payload: {},
      runAt: new Date(Date.now() + 5 * 60_000),
    },
    update: {},
  });
}
