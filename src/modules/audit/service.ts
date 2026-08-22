import type { Prisma, UserRole } from "@prisma/client";

export interface ActorContext {
  userId: string;
  role: UserRole;
  requestId?: string;
  maskedIp?: string;
  userAgent?: string;
}

export async function writeAudit(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  input: {
    action: string;
    entityType: string;
    entityId?: string;
    before?: Prisma.InputJsonValue;
    after?: Prisma.InputJsonValue;
  }
) {
  return tx.auditLog.create({
    data: {
      actorUserId: actor.userId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: input.before,
      after: input.after,
      requestId: actor.requestId,
      maskedIp: actor.maskedIp,
      userAgent: actor.userAgent?.slice(0, 500),
    },
  });
}
