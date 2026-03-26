import { randomUUID } from "crypto";
import { getDb } from "../db/connection.js";
import { logger } from "../utils/logger.js";

export interface Campaign {
  id: string;
  name: string;
  subject: string;
  body_html: string;
  body_text: string;
  status: string;
  tag_filter: string | null;
  sent_count: number;
  failed_count: number;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
}

export interface CampaignStats {
  total_sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  complained: number;
}


export function listCampaigns(): Campaign[] {
  const db = getDb();
  return db.prepare("SELECT * FROM campaigns ORDER BY updated_at DESC").all() as Campaign[];
}

export function getCampaign(id: string): Campaign | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM campaigns WHERE id = ?").get(id) as Campaign | undefined;
}

export function createCampaign(data: { name: string; subject?: string; body_html?: string; body_text?: string; tag_filter?: string | null }): Campaign {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO campaigns (id, name, subject, body_html, body_text, tag_filter)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, data.name, data.subject || "", data.body_html || "", data.body_text || "", data.tag_filter || null);
  return getCampaign(id)!;
}

export function updateCampaign(id: string, data: Partial<Pick<Campaign, "name" | "subject" | "body_html" | "body_text" | "tag_filter">>): Campaign | undefined {
  const db = getDb();
  const campaign = getCampaign(id);
  if (!campaign) return undefined;
  if (campaign.status === "sent" || campaign.status === "sending") return undefined; // can't edit locked campaigns

  const fields: string[] = [];
  const values: any[] = [];

  if (data.name !== undefined) { fields.push("name = ?"); values.push(data.name); }
  if (data.subject !== undefined) { fields.push("subject = ?"); values.push(data.subject); }
  if (data.body_html !== undefined) { fields.push("body_html = ?"); values.push(data.body_html); }
  if (data.body_text !== undefined) { fields.push("body_text = ?"); values.push(data.body_text); }
  if (data.tag_filter !== undefined) { fields.push("tag_filter = ?"); values.push(data.tag_filter); }

  if (fields.length === 0) return campaign;

  fields.push("updated_at = datetime('now')");
  values.push(id);

  db.prepare(`UPDATE campaigns SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getCampaign(id);
}

export function deleteCampaign(id: string): boolean {
  const db = getDb();
  const campaign = getCampaign(id);
  if (!campaign || campaign.status === "sending") {
    return false;
  }
  const result = db.prepare("DELETE FROM campaigns WHERE id = ?").run(id);
  return result.changes > 0;
}

export function duplicateCampaign(id: string): Campaign | undefined {
  const original = getCampaign(id);
  if (!original) return undefined;

  return createCampaign({
    name: `${original.name} (Copy)`,
    subject: original.subject,
    body_html: original.body_html,
    body_text: original.body_text,
    tag_filter: original.tag_filter || undefined,
  });
}

export function markCampaignSending(id: string): void {
  const db = getDb();
  db.prepare("UPDATE campaigns SET status = 'sending', updated_at = datetime('now') WHERE id = ?").run(id);
}

export function tryMarkCampaignSending(id: string): boolean {
  const db = getDb();
  const result = db.prepare(
    `UPDATE campaigns
     SET status = 'sending', updated_at = datetime('now')
     WHERE id = ?
       AND status NOT IN ('sending', 'sent')`
  ).run(id);
  return result.changes > 0;
}

export function markCampaignDraft(id: string): void {
  const db = getDb();
  db.prepare(
    `UPDATE campaigns SET status = 'draft', updated_at = datetime('now') WHERE id = ?`
  ).run(id);
}

export function markCampaignFailed(id: string): void {
  const db = getDb();
  db.prepare(
    `UPDATE campaigns SET status = 'failed', updated_at = datetime('now') WHERE id = ?`
  ).run(id);
}

export function markCampaignSent(id: string, sentCount: number, failedCount: number): void {
  const db = getDb();
  db.prepare(
    `UPDATE campaigns SET status = 'sent', sent_count = ?, failed_count = ?, sent_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
  ).run(sentCount, failedCount, id);
}

export function getCampaignStats(id: string): CampaignStats {
  const db = getDb();
  const row = db.prepare(
    `SELECT
      SUM(CASE WHEN status != 'failed' THEN 1 ELSE 0 END) as total_sent,
      SUM(CASE WHEN delivery_status = 'delivered' THEN 1 ELSE 0 END) as delivered,
      SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) as opened,
      SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) as clicked,
      SUM(CASE WHEN delivery_status = 'bounced' THEN 1 ELSE 0 END) as bounced,
      SUM(CASE WHEN delivery_status = 'complained' THEN 1 ELSE 0 END) as complained
    FROM send_logs WHERE campaign_id = ?`
  ).get(id) as any;

  return {
    total_sent: row.total_sent || 0,
    delivered: row.delivered || 0,
    opened: row.opened || 0,
    clicked: row.clicked || 0,
    bounced: row.bounced || 0,
    complained: row.complained || 0,
  };
}
