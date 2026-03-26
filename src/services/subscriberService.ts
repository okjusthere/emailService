import { randomUUID } from "crypto";
import { getDb } from "../db/connection.js";
import { logger } from "../utils/logger.js";

export interface Subscriber {
  id: number;
  email: string;
  name: string | null;
  status: string;
  unsubscribe_token: string;
  last_sent_at: string | null;
  send_count: number;
  created_at: string;
  updated_at: string;
}

/**
 * Get the next batch of active subscribers for a campaign.
 * DEDUP: Excludes subscribers already accepted for this campaign.
 */
export function getNextCampaignBatch(
  campaignId: string,
  count: number,
  tagIds?: number[]
): Subscriber[] {
  const db = getDb();

  if (tagIds && tagIds.length > 0) {
    const placeholders = tagIds.map(() => "?").join(",");
    return db.prepare(`
      SELECT DISTINCT s.* FROM subscribers s
      JOIN subscriber_tags st ON st.subscriber_id = s.id
      WHERE s.status = 'active'
        AND st.tag_id IN (${placeholders})
        AND NOT EXISTS (
          SELECT 1 FROM send_logs sl
          WHERE sl.subscriber_id = s.id
            AND sl.campaign_id = ?
            AND sl.status != 'failed'
        )
      ORDER BY
        CASE WHEN s.last_sent_at IS NULL THEN 0 ELSE 1 END,
        s.last_sent_at ASC,
        s.id ASC
      LIMIT ?
    `).all(...tagIds, campaignId, count) as Subscriber[];
  }

  return db.prepare(`
    SELECT s.* FROM subscribers s
    WHERE s.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM send_logs sl
        WHERE sl.subscriber_id = s.id
          AND sl.campaign_id = ?
          AND sl.status != 'failed'
      )
    ORDER BY
      CASE WHEN s.last_sent_at IS NULL THEN 0 ELSE 1 END,
      s.last_sent_at ASC,
      s.id ASC
    LIMIT ?
  `).all(campaignId, count) as Subscriber[];
}

export function countRemainingCampaignRecipients(
  campaignId: string,
  tagIds?: number[]
): number {
  const db = getDb();

  if (tagIds && tagIds.length > 0) {
    const placeholders = tagIds.map(() => "?").join(",");
    const row = db.prepare(`
      SELECT COUNT(DISTINCT s.id) AS count
      FROM subscribers s
      JOIN subscriber_tags st ON st.subscriber_id = s.id
      WHERE s.status = 'active'
        AND st.tag_id IN (${placeholders})
        AND NOT EXISTS (
          SELECT 1 FROM send_logs sl
          WHERE sl.subscriber_id = s.id
            AND sl.campaign_id = ?
            AND sl.status != 'failed'
        )
    `).get(...tagIds, campaignId) as { count: number };
    return row.count || 0;
  }

  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM subscribers s
    WHERE s.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM send_logs sl
        WHERE sl.subscriber_id = s.id
          AND sl.campaign_id = ?
          AND sl.status != 'failed'
      )
  `).get(campaignId) as { count: number };

  return row.count || 0;
}

/**
 * Mark subscribers as sent (update last_sent_at and increment send_count)
 */
export function markAsSent(subscriberIds: number[]): void {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE subscribers
    SET last_sent_at = datetime('now'),
        send_count = send_count + 1,
        updated_at = datetime('now')
    WHERE id = ?
  `);
  const updateMany = db.transaction((ids: number[]) => {
    for (const id of ids) {
      stmt.run(id);
    }
  });
  updateMany(subscriberIds);
}

/**
 * Update subscriber status (e.g., bounced, complained, unsubscribed)
 */
export function updateSubscriberStatus(
  email: string,
  status: string
): boolean {
  const db = getDb();
  const result = db
    .prepare(
      `UPDATE subscribers SET status = ?, updated_at = datetime('now') WHERE email = ?`
    )
    .run(status, email);
  return result.changes > 0;
}

/**
 * Find subscriber by unsubscribe token
 */
export function findByToken(token: string): Subscriber | undefined {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM subscribers WHERE unsubscribe_token = ?`)
    .get(token) as Subscriber | undefined;
}

/**
 * Find subscriber by email
 */
export function findByEmail(email: string): Subscriber | undefined {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM subscribers WHERE email = ?`)
    .get(email) as Subscriber | undefined;
}

/**
 * Find subscriber by Resend email ID (via send_logs)
 */
export function findByResendEmailId(
  resendEmailId: string
): Subscriber | undefined {
  const db = getDb();
  return db
    .prepare(
      `SELECT s.* FROM subscribers s
       JOIN send_logs sl ON s.id = sl.subscriber_id
       WHERE sl.resend_email_id = ?`
    )
    .get(resendEmailId) as Subscriber | undefined;
}

/**
 * Unsubscribe a user by token
 */
export function unsubscribeByToken(
  token: string,
  reason?: string
): boolean {
  const db = getDb();
  const subscriber = findByToken(token);
  if (!subscriber || subscriber.status === "unsubscribed") {
    return false;
  }

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE subscribers SET status = 'unsubscribed', updated_at = datetime('now') WHERE id = ?`
    ).run(subscriber.id);

    db.prepare(
      `INSERT INTO unsubscribes (subscriber_id, reason) VALUES (?, ?)`
    ).run(subscriber.id, reason || null);
  });

  tx();
  logger.info(`Unsubscribed: ${subscriber.email}`);
  return true;
}

/**
 * Add a new subscriber
 */
export function addSubscriber(
  email: string,
  name?: string
): Subscriber | null {
  const db = getDb();
  const token = randomUUID();
  try {
    db.prepare(
      `INSERT INTO subscribers (email, name, unsubscribe_token) VALUES (?, ?, ?)`
    ).run(email, name || null, token);
    return findByEmail(email) || null;
  } catch (err: any) {
    if (err.message?.includes("UNIQUE constraint")) {
      logger.warn(`Subscriber already exists: ${email}`);
      return null;
    }
    throw err;
  }
}

/**
 * Bulk import subscribers from an array
 */
export function bulkImport(
  users: { email: string; name?: string }[]
): { imported: number; skipped: number } {
  const db = getDb();
  let imported = 0;
  let skipped = 0;

  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO subscribers (email, name, unsubscribe_token) VALUES (?, ?, ?)`
  );

  const importTx = db.transaction(
    (items: { email: string; name?: string }[]) => {
      for (const item of items) {
        const result = insertStmt.run(
          item.email,
          item.name || null,
          randomUUID()
        );
        if (result.changes > 0) imported++;
        else skipped++;
      }
    }
  );

  importTx(users);
  logger.success(`Import complete: ${imported} imported, ${skipped} skipped`);
  return { imported, skipped };
}

/**
 * Get subscriber stats
 */
export function getStats(): {
  total: number;
  active: number;
  unsubscribed: number;
  bounced: number;
  complained: number;
} {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN status = 'unsubscribed' THEN 1 ELSE 0 END) as unsubscribed,
        SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END) as bounced,
        SUM(CASE WHEN status = 'complained' THEN 1 ELSE 0 END) as complained
      FROM subscribers`
    )
    .get() as any;
  return row;
}
