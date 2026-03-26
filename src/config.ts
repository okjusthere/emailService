import dotenv from "dotenv";
dotenv.config();

export const config = {
  // Resend
  resendApiKey: process.env.RESEND_API_KEY || "",
  fromEmail: process.env.FROM_EMAIL || "",
  fromName: process.env.FROM_NAME || "",
  replyToEmail: process.env.REPLY_TO_EMAIL || "",

  // API authentication
  apiSecret: process.env.API_SECRET || "",

  // Server
  port: parseInt(process.env.PORT || "3000", 10),
  baseUrl: process.env.BASE_URL || "http://localhost:3000",

  // Sending
  dailySendCount: parseInt(process.env.DAILY_SEND_COUNT || "5000", 10),
  batchSize: parseInt(process.env.BATCH_SIZE || "100", 10),

  // IP Warmup: date you started sending (YYYY-MM-DD). Auto-limits volume for first 14 days.
  // Once you've been sending for 14+ days, this has no effect.
  sendStartDate: process.env.SEND_START_DATE || "",

  // Webhook
  resendWebhookSecret: process.env.RESEND_WEBHOOK_SECRET || "",

  // Subscription
  doubleOptIn: process.env.DOUBLE_OPTIN !== "false", // default: true

  // Company info (CAN-SPAM required — set in .env)
  company: {
    name: process.env.COMPANY_NAME || "",
    address: process.env.COMPANY_ADDRESS || "",
  },
} as const;
