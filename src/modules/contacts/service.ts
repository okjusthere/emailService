import {
  ContactSourceType,
  ContactStatus,
  ContactType,
  PermissionBasis,
  Prisma,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { inTransaction } from "../../db/transactions.js";
import { DomainError } from "../../shared/errors.js";
import { normalizeEmail } from "../../shared/normalize.js";
import { contactInputSchema, paginationSchema } from "../../shared/schemas.js";
import type { ActorContext } from "../audit/service.js";
import { writeAudit } from "../audit/service.js";

const contactListSchema = paginationSchema.extend({
  contactType: z.enum(ContactType).optional(),
  sourceType: z.enum(ContactSourceType).optional(),
  permissionBasis: z.enum(PermissionBasis).optional(),
  status: z.enum(ContactStatus).optional(),
  marketId: z.uuid().optional(),
  propertyInterestId: z.uuid().optional(),
  tagId: z.uuid().optional(),
  suppressed: z.enum(["true", "false"]).optional(),
  sort: z.enum(["createdAt", "lastEngagedAt", "lastSentAt"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

type ContactListInput = z.infer<typeof contactListSchema>;

function contactClauses(page: ContactListInput): Prisma.Sql[] {
  const clauses: Prisma.Sql[] = [];
  if (page.search) {
    const search = `%${page.search}%`;
    clauses.push(
      Prisma.sql`(c.email ILIKE ${search} OR c.display_name ILIKE ${search} OR c.company ILIKE ${search})`
    );
  }
  if (page.contactType)
    clauses.push(Prisma.sql`c.contact_type = ${page.contactType}::"ContactType"`);
  if (page.sourceType)
    clauses.push(Prisma.sql`c.source_type = ${page.sourceType}::"ContactSourceType"`);
  if (page.permissionBasis)
    clauses.push(Prisma.sql`c.permission_basis = ${page.permissionBasis}::"PermissionBasis"`);
  if (page.status) clauses.push(Prisma.sql`c.status = ${page.status}::"ContactStatus"`);
  if (page.tagId)
    clauses.push(
      Prisma.sql`EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = c.id AND ct.tag_id = ${page.tagId}::uuid)`
    );
  if (page.marketId)
    clauses.push(
      Prisma.sql`EXISTS (SELECT 1 FROM contact_markets cm WHERE cm.contact_id = c.id AND cm.market_id = ${page.marketId}::uuid)`
    );
  if (page.propertyInterestId)
    clauses.push(
      Prisma.sql`EXISTS (SELECT 1 FROM contact_property_interests cpi WHERE cpi.contact_id = c.id AND cpi.property_interest_id = ${page.propertyInterestId}::uuid)`
    );
  if (page.suppressed)
    clauses.push(
      page.suppressed === "true"
        ? Prisma.sql`EXISTS (SELECT 1 FROM suppressions s WHERE s.email_normalized = c.email_normalized AND s.is_active)`
        : Prisma.sql`NOT EXISTS (SELECT 1 FROM suppressions s WHERE s.email_normalized = c.email_normalized AND s.is_active)`
    );
  return clauses;
}

function contactOrder(page: ContactListInput): Prisma.Sql {
  const direction = page.order === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const column =
    page.sort === "lastEngagedAt"
      ? Prisma.sql`c.last_engaged_at`
      : page.sort === "lastSentAt"
        ? Prisma.sql`c.last_sent_at`
        : Prisma.sql`c.created_at`;
  return Prisma.sql`${column} ${direction} NULLS LAST, c.id ${direction}`;
}

async function matchingContactIds(page: ContactListInput, limit: number, offset: number) {
  const clauses = contactClauses(page);
  if (page.cursor) {
    const anchor = await prisma.contact.findUnique({
      where: { id: page.cursor },
      select: { createdAt: true, lastEngagedAt: true, lastSentAt: true },
    });
    if (!anchor) return [];
    const column =
      page.sort === "lastEngagedAt"
        ? Prisma.sql`c.last_engaged_at`
        : page.sort === "lastSentAt"
          ? Prisma.sql`c.last_sent_at`
          : Prisma.sql`c.created_at`;
    const value = anchor[page.sort];
    if (value === null) {
      clauses.push(
        page.order === "asc"
          ? Prisma.sql`(${column} IS NULL AND c.id > ${page.cursor}::uuid)`
          : Prisma.sql`(${column} IS NULL AND c.id < ${page.cursor}::uuid)`
      );
    } else {
      clauses.push(
        page.order === "asc"
          ? Prisma.sql`(${column} > ${value} OR (${column} = ${value} AND c.id > ${page.cursor}::uuid) OR ${column} IS NULL)`
          : Prisma.sql`(${column} < ${value} OR (${column} = ${value} AND c.id < ${page.cursor}::uuid) OR ${column} IS NULL)`
      );
    }
  }
  const where = clauses.length ? Prisma.sql`WHERE ${Prisma.join(clauses, " AND ")}` : Prisma.empty;
  return prisma.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT c.id FROM contacts c ${where} ORDER BY ${contactOrder(page)} LIMIT ${limit} OFFSET ${offset}`
  );
}

async function countMatchingContacts(page: ContactListInput): Promise<number> {
  const clauses = contactClauses({ ...page, cursor: undefined });
  const where = clauses.length ? Prisma.sql`WHERE ${Prisma.join(clauses, " AND ")}` : Prisma.empty;
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(
    Prisma.sql`SELECT count(*) AS count FROM contacts c ${where}`
  );
  return Number(rows[0]?.count ?? 0);
}

export async function listContacts(query: unknown) {
  const parsed = contactListSchema.parse(query);
  const offset = parsed.cursor ? 0 : (parsed.page - 1) * parsed.limit;
  const [ids, total] = await Promise.all([
    matchingContactIds(parsed, parsed.limit, offset),
    countMatchingContacts(parsed),
  ]);
  const idOrder = new Map(ids.map((row, index) => [row.id, index]));
  const items = (
    await prisma.contact.findMany({
      where: { id: { in: ids.map((row) => row.id) } },
      include: {
        tags: { include: { tag: true } },
        markets: { include: { market: true } },
        propertyInterests: { include: { propertyInterest: true } },
      },
    })
  ).sort((left, right) => (idOrder.get(left.id) ?? 0) - (idOrder.get(right.id) ?? 0));
  const suppressions = await prisma.suppression.findMany({
    where: { isActive: true, emailNormalized: { in: items.map((item) => item.emailNormalized) } },
    select: { emailNormalized: true, reason: true },
  });
  const suppressionByEmail = new Map(
    suppressions.map((item) => [item.emailNormalized, item.reason])
  );
  return {
    items: items.map((item) => ({
      ...item,
      suppressed: suppressionByEmail.has(item.emailNormalized),
      suppressionReason: suppressionByEmail.get(item.emailNormalized) ?? null,
    })),
    page: parsed.page,
    limit: parsed.limit,
    total,
    nextCursor: items.length === parsed.limit ? (items.at(-1)?.id ?? null) : null,
  };
}

export async function countContactsForExport(query: unknown): Promise<number> {
  const parsed = contactListSchema.omit({ page: true, limit: true, cursor: true }).parse(query);
  return countMatchingContacts(contactListSchema.parse({ ...parsed, limit: 1 }));
}

export async function* iterateContactsForExport(query: unknown) {
  const filters = contactListSchema.omit({ page: true, limit: true, cursor: true }).parse(query);
  const parsed = contactListSchema.parse({ ...filters, limit: 100 });
  let offset = 0;

  while (true) {
    const ids = await matchingContactIds(parsed, 500, offset);
    const contacts = await prisma.contact.findMany({
      where: { id: { in: ids.map((row) => row.id) } },
      select: {
        id: true,
        email: true,
        emailNormalized: true,
        displayName: true,
        company: true,
        contactType: true,
        permissionBasis: true,
      },
    });
    const idOrder = new Map(ids.map((row, index) => [row.id, index]));
    contacts.sort((left, right) => (idOrder.get(left.id) ?? 0) - (idOrder.get(right.id) ?? 0));
    if (contacts.length === 0) return;

    const suppressions = await prisma.suppression.findMany({
      where: {
        isActive: true,
        emailNormalized: { in: contacts.map((contact) => contact.emailNormalized) },
      },
      select: { emailNormalized: true, reason: true },
    });
    const suppressionByEmail = new Map(
      suppressions.map((suppression) => [suppression.emailNormalized, suppression.reason])
    );
    for (const contact of contacts) {
      yield {
        ...contact,
        suppressed: suppressionByEmail.has(contact.emailNormalized),
        suppressionReason: suppressionByEmail.get(contact.emailNormalized) ?? null,
      };
    }

    if (contacts.length < 500) return;
    offset += contacts.length;
  }
}

export async function createContact(body: unknown, actor: ActorContext) {
  const input = contactInputSchema.parse(body);
  const emailNormalized = normalizeEmail(input.email);
  return inTransaction(async (tx) => {
    const existing = await tx.contact.findUnique({ where: { emailNormalized } });
    if (existing)
      throw new DomainError("CONTACT_DUPLICATE", "A contact with this email already exists.", 409, {
        contactId: existing.id,
      });
    const contact = await tx.contact.create({
      data: {
        email: input.email.trim(),
        emailNormalized,
        firstName: input.firstName,
        lastName: input.lastName,
        displayName: input.displayName,
        company: input.company,
        jobTitle: input.jobTitle,
        phone: input.phone,
        contactType: input.contactType,
        sourceType: input.sourceType,
        sourceDetail: input.sourceDetail,
        permissionBasis: input.permissionBasis,
        notes: input.notes,
        tags: input.tagIds?.length
          ? { create: input.tagIds.map((tagId) => ({ tagId })) }
          : undefined,
        markets: input.marketIds?.length
          ? { create: input.marketIds.map((marketId) => ({ marketId })) }
          : undefined,
        propertyInterests: input.propertyInterestIds?.length
          ? {
              create: input.propertyInterestIds.map((propertyInterestId) => ({
                propertyInterestId,
              })),
            }
          : undefined,
      },
    });
    await writeAudit(tx, actor, {
      action: "contact.create",
      entityType: "contact",
      entityId: contact.id,
      after: {
        emailNormalized,
        sourceType: contact.sourceType,
        permissionBasis: contact.permissionBasis,
      },
    });
    return contact;
  });
}

export async function updateContact(id: string, body: unknown, actor: ActorContext) {
  const input = contactInputSchema.partial().parse(body);
  return inTransaction(async (tx) => {
    const before = await tx.contact.findUnique({ where: { id } });
    if (!before) throw new DomainError("CONTACT_NOT_FOUND", "Contact not found.", 404);
    const emailNormalized = input.email ? normalizeEmail(input.email) : undefined;
    const contact = await tx.contact.update({
      where: { id },
      data: {
        ...(input.email ? { email: input.email.trim(), emailNormalized } : {}),
        firstName: input.firstName,
        lastName: input.lastName,
        displayName: input.displayName,
        company: input.company,
        jobTitle: input.jobTitle,
        phone: input.phone,
        contactType: input.contactType,
        sourceType: input.sourceType,
        sourceDetail: input.sourceDetail,
        permissionBasis: input.permissionBasis,
        notes: input.notes,
        ...(input.tagIds
          ? { tags: { deleteMany: {}, create: input.tagIds.map((tagId) => ({ tagId })) } }
          : {}),
        ...(input.marketIds
          ? {
              markets: {
                deleteMany: {},
                create: input.marketIds.map((marketId) => ({ marketId })),
              },
            }
          : {}),
        ...(input.propertyInterestIds
          ? {
              propertyInterests: {
                deleteMany: {},
                create: input.propertyInterestIds.map((propertyInterestId) => ({
                  propertyInterestId,
                })),
              },
            }
          : {}),
      },
    });
    await writeAudit(tx, actor, {
      action: "contact.update",
      entityType: "contact",
      entityId: id,
      before: { emailNormalized: before.emailNormalized, status: before.status },
      after: { emailNormalized: contact.emailNormalized, status: contact.status },
    });
    return contact;
  });
}

export async function archiveContact(id: string, actor: ActorContext) {
  return inTransaction(async (tx) => {
    const contact = await tx.contact.update({
      where: { id },
      data: { status: "ARCHIVED", archivedAt: new Date() },
    });
    await writeAudit(tx, actor, { action: "contact.archive", entityType: "contact", entityId: id });
    return contact;
  });
}

export async function restoreContact(id: string, actor: ActorContext) {
  return inTransaction(async (tx) => {
    const contact = await tx.contact.update({
      where: { id },
      data: { status: "ACTIVE", archivedAt: null },
    });
    await writeAudit(tx, actor, { action: "contact.restore", entityType: "contact", entityId: id });
    return contact;
  });
}
