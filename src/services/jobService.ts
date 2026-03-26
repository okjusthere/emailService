import { randomUUID } from "crypto";
import { getDb } from "../db/connection.js";
import { logger } from "../utils/logger.js";

export interface Job {
  id: string;
  type: string;
  payload: string;
  status: "pending" | "running" | "completed" | "failed";
  result: string | null;
  error: string | null;
  attempts: number;
  max_attempts: number;
  run_after: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

/**
 * Create a new job and return it.
 */
export function createJob(
  type: string,
  payload: Record<string, unknown>,
  opts?: { maxAttempts?: number; runAfter?: Date }
): Job {
  const db = getDb();
  const id = randomUUID();
  const maxAttempts = opts?.maxAttempts ?? 3;
  const runAfter = opts?.runAfter
    ? opts.runAfter.toISOString().replace("T", " ").replace("Z", "")
    : null;

  db.prepare(
    `INSERT INTO jobs (id, type, payload, max_attempts${runAfter ? ", run_after" : ""})
     VALUES (?, ?, ?, ?${runAfter ? ", ?" : ""})`
  ).run(
    ...[id, type, JSON.stringify(payload), maxAttempts, ...(runAfter ? [runAfter] : [])]
  );

  return getJob(id)!;
}

/**
 * Atomically claim the oldest pending job that is ready to run.
 * Returns the job if one was claimed, or undefined if the queue is empty.
 */
export function claimNextJob(): Job | undefined {
  const db = getDb();

  // Use a transaction to atomically find + update
  const job = db.transaction(() => {
    const row = db.prepare(
      `SELECT * FROM jobs
       WHERE status = 'pending' AND run_after <= datetime('now')
       ORDER BY created_at ASC
       LIMIT 1`
    ).get() as Job | undefined;

    if (!row) return undefined;

    db.prepare(
      `UPDATE jobs
       SET status = 'running', attempts = attempts + 1, started_at = datetime('now')
       WHERE id = ?`
    ).run(row.id);

    return getJob(row.id)!;
  })();

  return job;
}

/**
 * Mark a job as completed with a result.
 */
export function completeJob(id: string, result: Record<string, unknown>): void {
  const db = getDb();
  db.prepare(
    `UPDATE jobs
     SET status = 'completed', result = ?, completed_at = datetime('now')
     WHERE id = ?`
  ).run(JSON.stringify(result), id);
}

/**
 * Mark a job as failed. If attempts < max_attempts, requeue with exponential backoff.
 */
export function failJob(id: string, errorMessage: string): void {
  const db = getDb();
  const job = getJob(id);
  if (!job) return;

  if (job.attempts < job.max_attempts) {
    // Exponential backoff: 30s, 120s, 480s...
    const delaySec = 30 * Math.pow(4, job.attempts - 1);
    logger.warn(
      `Job ${id} failed (attempt ${job.attempts}/${job.max_attempts}), retrying in ${delaySec}s: ${errorMessage}`
    );
    db.prepare(
      `UPDATE jobs
       SET status = 'pending', error = ?,
           run_after = datetime('now', '+${delaySec} seconds')
       WHERE id = ?`
    ).run(errorMessage, id);
  } else {
    logger.error(`Job ${id} permanently failed after ${job.attempts} attempts: ${errorMessage}`);
    db.prepare(
      `UPDATE jobs
       SET status = 'failed', error = ?, completed_at = datetime('now')
       WHERE id = ?`
    ).run(errorMessage, id);
  }
}

/**
 * Get a job by ID.
 */
export function getJob(id: string): Job | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Job | undefined;
}

/**
 * List jobs, optionally filtered by status.
 */
export function listJobs(opts?: { status?: string; limit?: number }): Job[] {
  const db = getDb();
  const conditions: string[] = [];
  const values: any[] = [];

  if (opts?.status) {
    conditions.push("status = ?");
    values.push(opts.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = opts?.limit ?? 50;
  values.push(limit);

  return db.prepare(
    `SELECT * FROM jobs ${where} ORDER BY created_at DESC LIMIT ?`
  ).all(...values) as Job[];
}

/**
 * On startup, reset any jobs stuck in 'running' state (from a previous crash)
 * back to 'pending' so they can be retried.
 */
export function recoverStuckJobs(): number {
  const db = getDb();
  const result = db.prepare(
    `UPDATE jobs SET status = 'pending' WHERE status = 'running'`
  ).run();
  if (result.changes > 0) {
    logger.warn(`Recovered ${result.changes} stuck job(s) from previous crash`);
  }
  return result.changes;
}
