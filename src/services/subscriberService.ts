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
 * Get the next batch of active subscribers to send to.
 * Uses round-robin: selects users with the oldest `last_sent_at` first,
 * then users who have never been sent to (NULL last_sent_at).
 * DEDUP: Excludes any subscriber already sent to today.
 */
export function getNextBatch(count: number): Subscriber[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM subscribers
    WHERE status = 'active'
      AND (last_sent_at IS NULL OR date(last_sent_at) < date('now'))
    ORDER BY
      CASE WHEN last_sent_at IS NULL THEN 0 ELSE 1 END,
      last_sent_at ASC
    LIMIT ?
  `);
  return stmt.all(count) as Subscriber[];
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
