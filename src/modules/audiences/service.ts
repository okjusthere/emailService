import { PermissionBasis, type Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { audienceFilterSchema } from "../../shared/schemas.js";
import { compileAudienceWhere } from "./domain.js";

export async function estimateAudience(body: unknown, includeSample: boolean) {
  const filter = audienceFilterSchema.parse(body);
  const broadWhere = compileAudienceWhere({ ...filter, requireKnownPermissionBasis: false }, false);
  const contacts = await prisma.contact.findMany({
    where: broadWhere,
    select: {
      id: true,
      email: true,
      emailNormalized: true,
      displayName: true,
      company: true,
      permissionBasis: true,
    },
    take: 50_000,
    orderBy: { id: "asc" },
  });
  const suppressed = await prisma.suppression.findMany({
    where: {
      isActive: true,
      emailNormalized: { in: contacts.map((contact) => contact.emailNormalized) },
    },
    select: { emailNormalized: true },
  });
  const suppressedEmails = new Set(suppressed.map((item) => item.emailNormalized));
  const unknownPermission = contacts.filter(
    (contact) => contact.permissionBasis === PermissionBasis.UNKNOWN
  ).length;
  const eligible = contacts.filter(
    (contact) =>
      !suppressedEmails.has(contact.emailNormalized) &&
      (!(filter.requireKnownPermissionBasis ?? true) ||
        contact.permissionBasis !== PermissionBasis.UNKNOWN)
  );
  return {
    matched: contacts.length,
    eligible: eligible.length,
    suppressed: suppressedEmails.size,
    unknownPermission,
    invalid: 0,
    sample: includeSample
      ? eligible.slice(0, 10).map(({ email, ...item }) => ({
          ...item,
          email: email.replace(/^(.).+(@.*)$/, "$1***$2"),
        }))
      : [],
  };
}

export async function resolveEligibleContacts(tx: Prisma.TransactionClient, body: unknown) {
  const filter = audienceFilterSchema.parse(body);
  return tx.contact.findMany({
    where: compileAudienceWhere(filter),
    orderBy: { id: "asc" },
    take: 50_000,
    select: {
      id: true,
      email: true,
      emailNormalized: true,
      firstName: true,
      lastName: true,
      displayName: true,
      company: true,
      permissionBasis: true,
    },
  });
}

export async function resolveAudienceContacts(tx: Prisma.TransactionClient, body: unknown) {
  const filter = audienceFilterSchema.parse(body);
  return tx.contact.findMany({
    where: compileAudienceWhere({ ...filter, requireKnownPermissionBasis: false }, false),
    orderBy: { id: "asc" },
    take: 50_000,
    select: {
      id: true,
      email: true,
      emailNormalized: true,
      firstName: true,
      lastName: true,
      displayName: true,
      company: true,
      permissionBasis: true,
    },
  });
}
