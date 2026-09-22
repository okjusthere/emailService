import { prisma } from "../src/db/prisma.js";
import { observeDomainTracking } from "../src/modules/tracking/service.js";

const domain = process.argv[2]?.trim().toLowerCase();
if (!domain || !/^[a-z0-9.-]+$/.test(domain)) {
  throw new Error("Usage: refresh-domain-tracking.ts SENDING_DOMAIN");
}
try {
  const senders = await prisma.senderProfile.findMany({
    where: { domain: { equals: domain, mode: "insensitive" } },
    select: { provider: true },
    distinct: ["provider"],
  });
  if (senders.length !== 1) throw new Error("Expected one provider for an existing sending domain");
  console.log(
    JSON.stringify(await observeDomainTracking(senders[0]!.provider, domain, true), null, 2)
  );
} finally {
  await prisma.$disconnect();
}
