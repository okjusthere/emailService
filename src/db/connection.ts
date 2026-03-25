import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { logger } from "../utils/logger.js";

const DB_PATH = path.join(process.cwd(), "data", "email_service.db");

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    logger.info(`Database connected: ${DB_PATH}`);
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    logger.info("Database connection closed");
  }
}
