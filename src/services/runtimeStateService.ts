import crypto from "crypto";
import { getDb } from "../db/connection.js";

const RATE_LIMIT_RETENTION_SECONDS = 60 * 60 * 24 * 2;

interface RateLimitResult {
  allowed: boolean;
  count: number;
  retryAfterSeconds: number;
}

function toSqliteDate(date: Date): string {
  return date.toISOString().replace("T", " ").replace("Z", "");
}

function parseSqliteDate(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value.replace(" ", "T") + "Z");
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function createAdminSessionRecord(ttlHours: number): {
  expiresAt: Date;
  token: string;
} {
  const db = getDb();
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

  pruneExpiredAdminSessions();

  db.prepare(
    `INSERT INTO admin_sessions (token, expires_at)
     VALUES (?, ?)`
  ).run(token, toSqliteDate(expiresAt));

  return { token, expiresAt };
}

export function hasValidAdminSessionToken(token: string): boolean {
  const db = getDb();
  pruneExpiredAdminSessions();

  const row = db.prepare(
    `SELECT token
     FROM admin_sessions
     WHERE token = ?
       AND expires_at > datetime('now')`
  ).get(token) as { token: string } | undefined;

  if (!row) {
    return false;
  }

  db.prepare(
    `UPDATE admin_sessions
     SET last_seen_at = datetime('now')
     WHERE token = ?`
  ).run(token);

  return true;
}

export function deleteAdminSessionToken(token: string): void {
  const db = getDb();
  db.prepare("DELETE FROM admin_sessions WHERE token = ?").run(token);
}

export function pruneExpiredAdminSessions(): number {
  const db = getDb();
  const result = db.prepare(
    `DELETE FROM admin_sessions
     WHERE expires_at <= datetime('now')`
  ).run();
  return result.changes;
}

export function registerRateLimitAttempt(
  scope: string,
  key: string,
  windowMs: number,
  maxAttempts: number
): RateLimitResult {
  const db = getDb();
  const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));
  const lowerBound = `-${windowSeconds} seconds`;
  const now = Date.now();

  return db.transaction(() => {
    db.prepare(
      `DELETE FROM rate_limit_events
       WHERE created_at < datetime('now', ?)`
    ).run(`-${RATE_LIMIT_RETENTION_SECONDS} seconds`);

    const row = db.prepare(
      `SELECT COUNT(*) AS count, MIN(created_at) AS oldest
       FROM rate_limit_events
       WHERE scope = ?
         AND key = ?
         AND created_at >= datetime('now', ?)`
    ).get(scope, key, lowerBound) as {
      count: number;
      oldest: string | null;
    };

    if (row.count >= maxAttempts) {
      const oldestTimestamp = parseSqliteDate(row.oldest);
      const retryAfterSeconds = oldestTimestamp
        ? Math.max(1, Math.ceil((windowMs - (now - oldestTimestamp)) / 1000))
        : windowSeconds;

      return {
        allowed: false,
        count: row.count,
        retryAfterSeconds,
      };
    }

    db.prepare(
      `INSERT INTO rate_limit_events (scope, key)
       VALUES (?, ?)`
    ).run(scope, key);

    return {
      allowed: true,
      count: row.count + 1,
      retryAfterSeconds: 0,
    };
  })();
}
