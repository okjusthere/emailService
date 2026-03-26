import path from "path";
import dotenv from "dotenv";
dotenv.config();

function parseIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOrigins(value: string | undefined, fallbackOrigin: string): string[] {
  const rawValues = (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const candidates = rawValues.length > 0 ? rawValues : [fallbackOrigin];

  return Array.from(
    new Set(
      candidates.flatMap((origin) => {
        try {
          return [new URL(origin).origin];
        } catch {
          return [];
        }
      })
    )
  );
}

function parseTemplateMode(
  value: string | undefined
): "personal" | "branded" {
  return value === "branded" ? "branded" : "personal";
}

const defaultDataDir = path.join(process.cwd(), "data");

export const config = {
  // Resend
  resendApiKey: process.env.RESEND_API_KEY || "",
  fromEmail: process.env.FROM_EMAIL || "",
  fromName: process.env.FROM_NAME || "",
  replyToEmail: process.env.REPLY_TO_EMAIL || "",

  // API authentication
  apiSecret: process.env.API_SECRET || "",
  adminSessionTtlHours: parseIntEnv(process.env.ADMIN_SESSION_TTL_HOURS, 12),

  // Server
  nodeEnv: process.env.NODE_ENV || "development",
  port: parseIntEnv(process.env.PORT, 3000),
  baseUrl: process.env.BASE_URL || "http://localhost:3000",
  dataDir: process.env.DATA_DIR || defaultDataDir,
  databasePath:
    process.env.DATABASE_PATH ||
    path.join(process.env.DATA_DIR || defaultDataDir, "email_service.db"),
  backupDir: process.env.BACKUP_DIR || path.join(process.cwd(), "backups"),

  // Sending
  dailySendCount: parseIntEnv(process.env.DAILY_SEND_COUNT, 5000),
  batchSize: parseIntEnv(process.env.BATCH_SIZE, 100),
  emailTemplateMode: parseTemplateMode(process.env.EMAIL_TEMPLATE_MODE),

  // IP Warmup: date you started sending (YYYY-MM-DD). Auto-limits volume for first 14 days.
  // Once you've been sending for 14+ days, this has no effect.
  sendStartDate: process.env.SEND_START_DATE || "",

  // Webhook
  resendWebhookSecret: process.env.RESEND_WEBHOOK_SECRET || "",

  // Subscription
  doubleOptIn: process.env.DOUBLE_OPTIN !== "false", // default: true
  subscribeAllowedOrigins: parseOrigins(
    process.env.SUBSCRIBE_ALLOWED_ORIGINS,
    process.env.BASE_URL || "http://localhost:3000"
  ),
  subscribeRateWindowMinutes: parseIntEnv(
    process.env.SUBSCRIBE_RATE_WINDOW_MINUTES,
    60
  ),
  subscribeIpWindowMax: parseIntEnv(process.env.SUBSCRIBE_IP_WINDOW_MAX, 20),
  subscribeEmailWindowMax: parseIntEnv(
    process.env.SUBSCRIBE_EMAIL_WINDOW_MAX,
    5
  ),
  confirmationResendCooldownMinutes: parseIntEnv(
    process.env.CONFIRMATION_RESEND_COOLDOWN_MINUTES,
    15
  ),

  // Company info (CAN-SPAM required — set in .env)
  company: {
    name: process.env.COMPANY_NAME || "",
    address: process.env.COMPANY_ADDRESS || "",
  },
} as const;
