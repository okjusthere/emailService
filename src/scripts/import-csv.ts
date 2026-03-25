/**
 * CLI tool to import subscribers from a CSV file.
 *
 * Usage:
 *   npx tsx src/scripts/import-csv.ts path/to/subscribers.csv
 *
 * CSV format (with header row):
 *   email,name
 *   john@example.com,John Doe
 *   jane@example.com,Jane Smith
 */

import fs from "fs";
import path from "path";
import { getDb } from "../db/connection.js";
import { runMigrations } from "../db/schema.js";
import { bulkImport, getStats } from "../services/subscriberService.js";
import { logger } from "../utils/logger.js";

function parseCSV(
  filePath: string
): { email: string; name?: string }[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.trim().split("\n");

  if (lines.length < 2) {
    throw new Error("CSV file must have a header row and at least one data row");
  }

  const header = lines[0].toLowerCase().split(",").map((h) => h.trim());
  const emailIndex = header.indexOf("email");
  const nameIndex = header.indexOf("name");

  if (emailIndex === -1) {
    throw new Error('CSV must have an "email" column');
  }

  const users: { email: string; name?: string }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const email = cols[emailIndex];
    if (!email || !email.includes("@")) continue;

    users.push({
      email: email.toLowerCase(),
      name: nameIndex >= 0 ? cols[nameIndex] || undefined : undefined,
    });
  }

  return users;
}

// ── Main ──────────────────────────────────────────
const csvPath = process.argv[2];

if (!csvPath) {
  console.error("Usage: npx tsx src/scripts/import-csv.ts <path-to-csv>");
  console.error("  CSV format: email,name");
  process.exit(1);
}

const resolvedPath = path.resolve(csvPath);
if (!fs.existsSync(resolvedPath)) {
  console.error(`File not found: ${resolvedPath}`);
  process.exit(1);
}

// Initialize DB
getDb();
runMigrations();

// Parse and import
logger.info(`Importing from: ${resolvedPath}`);
const users = parseCSV(resolvedPath);
logger.info(`Found ${users.length} valid email addresses`);

const result = bulkImport(users);
logger.success(`Done! Imported: ${result.imported}, Skipped (duplicates): ${result.skipped}`);

const stats = getStats();
logger.info("Current stats:", stats);
process.exit(0);
