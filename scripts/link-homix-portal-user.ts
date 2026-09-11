import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { writeAudit } from "../src/modules/audit/service.js";

// Administrative repair only. No implicit email-based linking in the API.
const { values } = parseArgs({
  options: {
    "portal-agent-id": { type: "string" },
    "user-id": { type: "string" },
    "expected-email": { type: "string" },
    "actor-user-id": { type: "string" },
    apply: { type: "boolean", default: false },
  },
});
const input = z
  .object({
    portalAgentId: z.coerce.number().int().positive(),
    userId: z.uuid(),
    expectedEmail: z.email().transform((v) => v.trim().toLowerCase()),
    actorUserId: z.uuid(),
  })
  .parse({
    portalAgentId: values["portal-agent-id"],
    userId: values["user-id"],
    expectedEmail: values["expected-email"],
    actorUserId: values["actor-user-id"],
  });
const prisma = new PrismaClient();
async function main() {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(891011, ${input.portalAgentId}::integer)`;
    const actor = await tx.user.findUniqueOrThrow({ where: { id: input.actorUserId } });
    if (!actor.isActive || actor.role !== "ADMIN")
      throw new Error("Actor must be an active Email Service administrator");
    const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId } });
    if (!user.isActive || user.emailNormalized !== input.expectedEmail)
      throw new Error("Active account and expected email must match");
    if (user.portalAgentId !== null && user.portalAgentId !== input.portalAgentId)
      throw new Error("Account is already linked to another Portal Agent");
    const occupied = await tx.user.findUnique({ where: { portalAgentId: input.portalAgentId } });
    if (occupied && occupied.id !== user.id)
      throw new Error("Portal Agent is already linked to another account");
    const changed = user.portalAgentId !== input.portalAgentId;
    if (values.apply && changed) {
      // Conditional write prevents a concurrent link to a different Agent.
      const updated = await tx.user.updateMany({
        where: {
          id: user.id,
          portalAgentId: null,
          emailNormalized: input.expectedEmail,
          isActive: true,
        },
        data: { portalAgentId: input.portalAgentId },
      });
      if (updated.count !== 1) throw new Error("Account changed; inspect and retry");
      await writeAudit(
        tx,
        {
          userId: actor.id,
          role: "ADMIN",
          requestId: randomUUID(),
          userAgent: "link-homix-portal-user CLI",
        },
        {
          action: "user.portal_linked",
          entityType: "user",
          entityId: user.id,
          before: { portalAgentId: null },
          after: { portalAgentId: input.portalAgentId },
        }
      );
    }
    return {
      mode: values.apply ? "apply" : "dry-run",
      userId: user.id,
      portalAgentId: input.portalAgentId,
      changed: values.apply && changed,
      wouldChange: changed,
    };
  });
  console.log(JSON.stringify(result));
}
main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : "Link failed");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
