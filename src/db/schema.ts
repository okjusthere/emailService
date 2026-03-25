import { getDb } from "./connection.js";
import { logger } from "../utils/logger.js";

export function runMigrations(): void {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS subscribers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      unsubscribe_token TEXT UNIQUE,
      last_sent_at DATETIME,
      send_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_subscribers_status ON subscribers(status);
    CREATE INDEX IF NOT EXISTS idx_subscribers_last_sent ON subscribers(last_sent_at);
    CREATE INDEX IF NOT EXISTS idx_subscribers_token ON subscribers(unsubscribe_token);

    CREATE TABLE IF NOT EXISTS send_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id TEXT NOT NULL,
      subscriber_id INTEGER REFERENCES subscribers(id),
      resend_email_id TEXT,
      status TEXT DEFAULT 'queued',
      error_message TEXT,
      sent_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_send_logs_batch ON send_logs(batch_id);
    CREATE INDEX IF NOT EXISTS idx_send_logs_resend_id ON send_logs(resend_email_id);

    CREATE TABLE IF NOT EXISTS batches (
      id TEXT PRIMARY KEY,
      total_count INTEGER NOT NULL,
      sent_count INTEGER DEFAULT 0,
      failed_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      started_at DATETIME,
      completed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS unsubscribes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subscriber_id INTEGER REFERENCES subscribers(id),
      reason TEXT,
      unsubscribed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  logger.success("Database migrations completed");
}
