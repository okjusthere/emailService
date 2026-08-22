import { Prisma, type Job, type PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "./prisma.js";
import { DomainError } from "../shared/errors.js";

export async function claimDueJob(
  workerId: string,
  lockSeconds: number,
  client: PrismaClient = prisma
): Promise<Job | null> {
  const rows = await client.$queryRaw<Job[]>(Prisma.sql`
    WITH candidate AS (
      SELECT id FROM jobs
      WHERE (
          status = 'PENDING'::"JobStatus"
          OR (status = 'RUNNING'::"JobStatus" AND lock_expires_at < now())
        )
        AND run_at <= now()
      ORDER BY run_at, created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE jobs j
    SET status = 'RUNNING'::"JobStatus",
        locked_at = now(),
        locked_by = ${workerId},
        lock_expires_at = now() + (${lockSeconds} * interval '1 second'),
        attempts = attempts + 1,
        updated_at = now()
    FROM candidate
    WHERE j.id = candidate.id
    RETURNING j.*
  `);
  return rows[0] ?? null;
}

interface ClaimedRecipientRow {
  id: string;
  email: string;
  email_normalized: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  company: string | null;
  unsubscribe_token_hash: string;
}

export async function reserveCampaignRecipients(input: {
  campaignId: string;
  senderProfileId: string;
  localDate: Date;
  timezone: string;
  effectiveLimit: number;
  requested: number;
}): Promise<{ batchId: string; recipients: ClaimedRecipientRow[]; reserved: number } | null> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw(Prisma.sql`
      INSERT INTO sender_daily_usage (id, sender_profile_id, local_date, timezone, reserved_count, accepted_count, released_count, created_at, updated_at)
      VALUES (${randomUUID()}::uuid, ${input.senderProfileId}::uuid, ${input.localDate}, ${input.timezone}, 0, 0, 0, now(), now())
      ON CONFLICT (sender_profile_id, local_date) DO NOTHING
    `);
          const usage = await tx.$queryRaw<
            Array<{ reserved_count: number; accepted_count: number }>
          >(Prisma.sql`
      SELECT reserved_count, accepted_count FROM sender_daily_usage
      WHERE sender_profile_id = ${input.senderProfileId}::uuid AND local_date = ${input.localDate}
      FOR UPDATE
    `);
          const row = usage[0];
          if (!row) throw new DomainError("QUOTA_ROW_MISSING", "Unable to lock sender quota.", 500);
          const allowed = Math.max(
            0,
            Math.min(
              input.requested,
              input.effectiveLimit - row.accepted_count - row.reserved_count
            )
          );
          if (allowed === 0) return null;
          const claimToken = randomUUID();
          const recipients = await tx.$queryRaw<ClaimedRecipientRow[]>(Prisma.sql`
      WITH candidates AS (
        SELECT cr.id FROM campaign_recipients cr
        WHERE cr.campaign_id = ${input.campaignId}::uuid
          AND cr.send_state IN ('PENDING'::"RecipientSendState", 'TEMPORARY_FAILED'::"RecipientSendState")
          AND (cr.next_attempt_at IS NULL OR cr.next_attempt_at <= now())
          AND NOT EXISTS (SELECT 1 FROM suppressions s WHERE s.email_normalized = cr.email_normalized AND s.is_active)
        ORDER BY cr.created_at
        FOR UPDATE SKIP LOCKED
        LIMIT ${allowed}
      )
      UPDATE campaign_recipients cr
      SET send_state = 'RESERVED'::"RecipientSendState", claim_token = ${claimToken}, claimed_at = now(), claim_expires_at = now() + interval '2 minutes', updated_at = now()
      FROM candidates WHERE cr.id = candidates.id
      RETURNING cr.id, cr.email, cr.email_normalized, cr.first_name, cr.last_name, cr.display_name, cr.company, cr.unsubscribe_token_hash
    `);
          if (recipients.length === 0) return null;
          await tx.$executeRaw`UPDATE sender_daily_usage SET reserved_count = reserved_count + ${recipients.length}, updated_at = now() WHERE sender_profile_id = ${input.senderProfileId}::uuid AND local_date = ${input.localDate}`;
          const batchId = randomUUID();
          const requestHash = createHash("sha256")
            .update(recipients.map((recipient) => recipient.id).join(","))
            .digest("hex");
          await tx.sendBatch.create({
            data: {
              id: batchId,
              campaignId: input.campaignId,
              senderProfileId: input.senderProfileId,
              status: "PREPARING",
              idempotencyKey: `campaign/${input.campaignId}/batch/${batchId}`,
              requestHash,
              recipientCount: recipients.length,
              idempotencyExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
          });
          await tx.campaignRecipient.updateMany({
            where: { id: { in: recipients.map((recipient) => recipient.id) } },
            data: { sendBatchId: batchId, sendState: "SENDING" },
          });
          return { batchId, recipients, reserved: recipients.length };
        },
        { isolationLevel: "Serializable" }
      );
    } catch (error) {
      const serializationFailure =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2034" ||
          (error.code === "P2010" && String(error.meta?.code ?? "") === "40001"));
      if (!serializationFailure || attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5 * (attempt + 1)));
    }
  }
  return null;
}
