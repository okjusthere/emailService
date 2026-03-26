import { getDb } from "../db/connection.js";

export interface Tag {
  id: number;
  name: string;
  color: string;
  created_at: string;
  subscriber_count?: number;
}

export function listTags(): Tag[] {
  const db = getDb();
  return db.prepare(
    `SELECT t.*, COUNT(st.subscriber_id) as subscriber_count
     FROM tags t
     LEFT JOIN subscriber_tags st ON st.tag_id = t.id
     GROUP BY t.id
     ORDER BY t.name ASC`
  ).all() as Tag[];
}

export function getTag(id: number): Tag | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM tags WHERE id = ?").get(id) as Tag | undefined;
}

export function createTag(name: string, color?: string): Tag | null {
  const db = getDb();
  try {
    db.prepare("INSERT INTO tags (name, color) VALUES (?, ?)").run(name.trim(), color || "#6366f1");
    return db.prepare("SELECT * FROM tags WHERE name = ?").get(name.trim()) as Tag;
  } catch (err: any) {
    if (err.message?.includes("UNIQUE constraint")) return null;
    throw err;
  }
}

export function deleteTag(id: number): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM tags WHERE id = ?").run(id);
  return result.changes > 0;
}

export function tagSubscribers(subscriberIds: number[], tagId: number): number {
  const db = getDb();
  const stmt = db.prepare("INSERT OR IGNORE INTO subscriber_tags (subscriber_id, tag_id) VALUES (?, ?)");
  let count = 0;
  const tx = db.transaction(() => {
    for (const sid of subscriberIds) {
      const r = stmt.run(sid, tagId);
      count += r.changes;
    }
  });
  tx();
  return count;
}

export function untagSubscribers(subscriberIds: number[], tagId: number): number {
  const db = getDb();
  const stmt = db.prepare("DELETE FROM subscriber_tags WHERE subscriber_id = ? AND tag_id = ?");
  let count = 0;
  const tx = db.transaction(() => {
    for (const sid of subscriberIds) {
      const r = stmt.run(sid, tagId);
      count += r.changes;
    }
  });
  tx();
  return count;
}

export function getSubscriberTags(subscriberId: number): Tag[] {
  const db = getDb();
  return db.prepare(
    `SELECT t.* FROM tags t
     JOIN subscriber_tags st ON st.tag_id = t.id
     WHERE st.subscriber_id = ?
     ORDER BY t.name ASC`
  ).all(subscriberId) as Tag[];
}

export function getTagIdByName(name: string): number | undefined {
  const db = getDb();
  const row = db.prepare("SELECT id FROM tags WHERE name = ?").get(name) as { id: number } | undefined;
  return row?.id;
}

/**
 * Get or create a tag by name. Returns the tag ID.
 */
export function getOrCreateTag(name: string): number {
  const trimmed = name.trim();
  const existing = getTagIdByName(trimmed);
  if (existing !== undefined) return existing;
  const tag = createTag(trimmed);
  if (tag) return tag.id;
  // Race condition fallback: tag was created between check and insert
  return getTagIdByName(trimmed)!;
}
