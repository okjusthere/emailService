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

    -- Campaigns
    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '',
      body_html TEXT NOT NULL DEFAULT '',
      body_text TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      tag_filter TEXT,
      sent_count INTEGER DEFAULT 0,
      failed_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      sent_at DATETIME
    );

    -- Tags for audience segmentation
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT DEFAULT '#6366f1',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS subscriber_tags (
      subscriber_id INTEGER NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (subscriber_id, tag_id)
    );

    CREATE INDEX IF NOT EXISTS idx_subscriber_tags_tag ON subscriber_tags(tag_id);

    -- Job queue
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      result TEXT,
      error TEXT,
      attempts INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 3,
      run_after DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME,
      completed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_status_run ON jobs(status, run_after);
  `);

  // Add campaign_id to send_logs if not present
  const sendLogCols = db.pragma("table_info(send_logs)") as { name: string }[];
  if (!sendLogCols.some((c) => c.name === "campaign_id")) {
    db.exec(`ALTER TABLE send_logs ADD COLUMN campaign_id TEXT`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_send_logs_campaign ON send_logs(campaign_id)`);
  }
  if (!sendLogCols.some((c) => c.name === "delivery_status")) {
    db.exec(`ALTER TABLE send_logs ADD COLUMN delivery_status TEXT`);
  }
  if (!sendLogCols.some((c) => c.name === "delivered_at")) {
    db.exec(`ALTER TABLE send_logs ADD COLUMN delivered_at DATETIME`);
  }
  if (!sendLogCols.some((c) => c.name === "opened_at")) {
    db.exec(`ALTER TABLE send_logs ADD COLUMN opened_at DATETIME`);
  }
  if (!sendLogCols.some((c) => c.name === "clicked_at")) {
    db.exec(`ALTER TABLE send_logs ADD COLUMN clicked_at DATETIME`);
  }
  if (!sendLogCols.some((c) => c.name === "bounced_at")) {
    db.exec(`ALTER TABLE send_logs ADD COLUMN bounced_at DATETIME`);
  }
  if (!sendLogCols.some((c) => c.name === "complained_at")) {
    db.exec(`ALTER TABLE send_logs ADD COLUMN complained_at DATETIME`);
  }
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_send_logs_campaign_subscriber
     ON send_logs(campaign_id, subscriber_id)`
  );

  db.exec(`
    UPDATE send_logs
    SET delivery_status = CASE
      WHEN status IN ('delivered', 'opened', 'clicked') THEN 'delivered'
      WHEN status = 'bounced' THEN 'bounced'
      WHEN status = 'complained' THEN 'complained'
      WHEN status = 'failed' THEN 'failed'
      WHEN status = 'sent' THEN 'sent'
      ELSE COALESCE(delivery_status, status)
    END
    WHERE delivery_status IS NULL OR delivery_status = '';

    UPDATE send_logs
    SET delivered_at = COALESCE(delivered_at, sent_at, created_at)
    WHERE status IN ('delivered', 'opened', 'clicked') AND delivered_at IS NULL;

    UPDATE send_logs
    SET opened_at = COALESCE(opened_at, created_at, sent_at)
    WHERE status IN ('opened', 'clicked') AND opened_at IS NULL;

    UPDATE send_logs
    SET clicked_at = COALESCE(clicked_at, created_at, sent_at)
    WHERE status = 'clicked' AND clicked_at IS NULL;

    UPDATE send_logs
    SET bounced_at = COALESCE(bounced_at, created_at, sent_at)
    WHERE status = 'bounced' AND bounced_at IS NULL;

    UPDATE send_logs
    SET complained_at = COALESCE(complained_at, created_at, sent_at)
    WHERE status = 'complained' AND complained_at IS NULL;
  `);

  // Add campaign_id to batches if not present
  const batchCols = db.pragma("table_info(batches)") as { name: string }[];
  if (!batchCols.some((c) => c.name === "campaign_id")) {
    db.exec(`ALTER TABLE batches ADD COLUMN campaign_id TEXT`);
  }

  // Add confirmation_token + confirmed_at for Double Opt-in
  const subscriberCols = db.pragma("table_info(subscribers)") as { name: string }[];
  if (!subscriberCols.some((c) => c.name === "confirmation_token")) {
    db.exec(`ALTER TABLE subscribers ADD COLUMN confirmation_token TEXT`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_subscribers_confirm_token ON subscribers(confirmation_token)`);
  }
  if (!subscriberCols.some((c) => c.name === "confirmed_at")) {
    db.exec(`ALTER TABLE subscribers ADD COLUMN confirmed_at DATETIME`);
  }
  if (!subscriberCols.some((c) => c.name === "confirmation_sent_at")) {
    db.exec(`ALTER TABLE subscribers ADD COLUMN confirmation_sent_at DATETIME`);
  }

  logger.success("Database migrations completed");
}
