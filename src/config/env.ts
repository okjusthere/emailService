import "dotenv/config";
import { z } from "zod";

const booleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const csvString = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );

const originCsvString = z
  .string()
  .default("")
  .transform((value, ctx) => {
    const origins: string[] = [];
    for (const item of value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)) {
      try {
        const url = new URL(item);
        if (
          !["https:", "http:"].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.pathname !== "/" ||
          url.search ||
          url.hash
        )
          throw new Error("not an origin");
        origins.push(url.origin);
      } catch {
        ctx.addIssue({
          code: "custom",
          message: `Invalid media origin: ${item}`,
        });
        return z.NEVER;
      }
    }
    return [...new Set(origins)];
  });

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_ROLE: z.enum(["web", "worker", "migrate"]).default("web"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    BASE_URL: z.url().default("http://localhost:3000"),
    DEFAULT_TIMEZONE: z.string().default("America/New_York"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    COMMIT_SHA: z.string().default("local"),
    DATABASE_URL: z.string().min(1),
    DIRECT_DATABASE_URL: z.string().min(1),
    AUTH_MODE: z.enum(["local", "azure-easyauth"]).default("local"),
    LOCAL_ADMIN_EMAIL: z.email().default("admin@homixny.com"),
    BOOTSTRAP_ADMIN_EMAILS: csvString,
    AUTO_PROVISION_USERS: booleanString,
    ALLOWED_EMAIL_DOMAINS: csvString,
    DEV_BYPASS_AUTH: booleanString,
    SESSION_SECRET: z.string().min(16).default("development-only-change-me"),
    RESEND_API_KEY: z.string().default(""),
    RESEND_WEBHOOK_SECRET: z.string().default(""),
    RESEND_WEBHOOK_PREVIOUS_SECRET: z.string().default(""),
    RESEND_WEBHOOK_PREVIOUS_SECRET_EXPIRES_AT: z.string().default(""),
    UNSUBSCRIBE_SIGNING_SECRET: z
      .string()
      .min(32)
      .default("development-unsubscribe-secret-change-me"),
    UNSUBSCRIBE_PREVIOUS_SIGNING_SECRET: z.string().default(""),
    UNSUBSCRIBE_PREVIOUS_SIGNING_SECRET_EXPIRES_AT: z.string().default(""),
    EMAIL_PROVIDER: z.enum(["resend", "fake"]).default("resend"),
    EMAIL_DELIVERY_MODE: z.enum(["disabled", "sandbox", "live"]).default("disabled"),
    EMAIL_TEST_ALLOWLIST: csvString,
    STORAGE_PROVIDER: z.enum(["local", "azure"]).default("local"),
    LOCAL_ASSET_DIR: z.string().default("./data/assets"),
    AZURE_STORAGE_ACCOUNT_URL: z.string().default(""),
    AZURE_STORAGE_CONTAINER: z.string().default("marketing-assets"),
    AZURE_PRIVATE_CONTAINER: z.string().default("private-exports"),
    PUBLIC_ASSET_BASE_URL: z.string().default("http://localhost:3000/public/assets"),
    COMPANY_NAME: z.string().min(1).default("Homix Realty"),
    COMPANY_POSTAL_ADDRESS: z.string().default("REQUIRED_BEFORE_LIVE_SEND"),
    COMPANY_WEBSITE: z.url().default("https://homixny.com"),
    APPLICATIONINSIGHTS_CONNECTION_STRING: z.string().default(""),
    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(250).default(2000),
    JOB_LOCK_SECONDS: z.coerce.number().int().min(30).default(120),
    WEBHOOK_RETENTION_DAYS: z.coerce.number().int().min(1).default(90),
    AUDIT_RETENTION_DAYS: z.coerce.number().int().min(365).default(365),
    ONEKEY_PROVIDER: z.enum(["disabled", "bbo", "fake"]).default("disabled"),
    BBO_LISTING_API_BASE_URL: z.string().default(""),
    BBO_MARKETING_API_KEY: z.string().default(""),
    ONEKEY_MEDIA_ALLOWED_ORIGINS: originCsvString,
    MLS_GRID_BASE_URL: z.string().default("https://api.mlsgrid.com/v2"),
    MLS_GRID_ACCESS_TOKEN: z.string().default(""),
    MLS_GRID_ORIGINATING_SYSTEM_NAME: z.string().default("onekey2"),
    ONEKEY_SYNC_ENABLED: booleanString,
    ONEKEY_SYNC_PAGE_SIZE: z.coerce.number().int().min(1).max(500).default(100),
    ONEKEY_SYNC_STATUSES: z.string().default("Active,Coming Soon,Pending"),
    ONEKEY_MEDIA_LIMIT: z.coerce.number().int().min(1).max(25).default(25),
    AI_PROVIDER: z.enum(["disabled", "openai", "azure-openai", "fake"]).default("disabled"),
    OPENAI_API_KEY: z.string().default(""),
    OPENAI_MODEL: z.string().default("gpt-5-mini"),
    OPENAI_BASE_URL: z.url().default("https://api.openai.com/v1"),
    AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
    AI_RATE_LIMIT_PER_HOUR: z.coerce.number().int().min(1).max(1000).default(30),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && env.AUTH_MODE === "local") {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH_MODE"],
        message: "Local auth is forbidden in production",
      });
    }
    if (env.NODE_ENV === "production" && env.DEV_BYPASS_AUTH) {
      ctx.addIssue({
        code: "custom",
        path: ["DEV_BYPASS_AUTH"],
        message: "Auth bypass is forbidden in production",
      });
    }
    if (env.NODE_ENV === "production" && !env.DATABASE_URL.includes("sslmode=require")) {
      ctx.addIssue({
        code: "custom",
        path: ["DATABASE_URL"],
        message: "Production PostgreSQL must require TLS",
      });
    }
    if (env.NODE_ENV === "production" && env.STORAGE_PROVIDER !== "azure") {
      ctx.addIssue({
        code: "custom",
        path: ["STORAGE_PROVIDER"],
        message: "Production asset storage must use Azure Blob Storage",
      });
    }
    if (
      env.EMAIL_DELIVERY_MODE === "live" &&
      /REQUIRED|PLACEHOLDER/i.test(env.COMPANY_POSTAL_ADDRESS)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["COMPANY_POSTAL_ADDRESS"],
        message: "Live delivery requires a real company postal address",
      });
    }
    if (
      env.EMAIL_DELIVERY_MODE === "live" &&
      /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(env.BASE_URL)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["BASE_URL"],
        message: "Live delivery requires a public application URL",
      });
    }
    if (
      env.APP_ROLE === "worker" &&
      env.EMAIL_DELIVERY_MODE !== "disabled" &&
      !env.RESEND_API_KEY &&
      env.EMAIL_PROVIDER === "resend"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["RESEND_API_KEY"],
        message: "Worker delivery requires a Resend key",
      });
    }
    if (env.STORAGE_PROVIDER === "azure" && !env.AZURE_STORAGE_ACCOUNT_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["AZURE_STORAGE_ACCOUNT_URL"],
        message: "Azure storage URL is required",
      });
    }
    if (
      env.NODE_ENV === "production" &&
      /development|change-me|required|placeholder/i.test(env.UNSUBSCRIBE_SIGNING_SECRET)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["UNSUBSCRIBE_SIGNING_SECRET"],
        message: "Production requires a non-placeholder unsubscribe signing secret",
      });
    }
    if (
      env.UNSUBSCRIBE_PREVIOUS_SIGNING_SECRET &&
      !env.UNSUBSCRIBE_PREVIOUS_SIGNING_SECRET_EXPIRES_AT
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["UNSUBSCRIBE_PREVIOUS_SIGNING_SECRET_EXPIRES_AT"],
        message: "Previous unsubscribe secrets require an expiry timestamp",
      });
    }
    if (
      env.ONEKEY_PROVIDER === "bbo" &&
      (!env.BBO_LISTING_API_BASE_URL || !env.BBO_MARKETING_API_KEY)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["BBO_MARKETING_API_KEY"],
        message: "The BBO OneKey provider requires its base URL and API key",
      });
    }
    if (["openai", "azure-openai"].includes(env.AI_PROVIDER) && !env.OPENAI_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["OPENAI_API_KEY"],
        message: "The OpenAI AI provider requires OPENAI_API_KEY",
      });
    }
    if (env.AI_PROVIDER === "azure-openai") {
      const endpoint = new URL(env.OPENAI_BASE_URL);
      if (
        endpoint.protocol !== "https:" ||
        !endpoint.hostname.endsWith(".openai.azure.com") ||
        !/^\/openai\/v1\/?$/.test(endpoint.pathname)
      )
        ctx.addIssue({
          code: "custom",
          path: ["OPENAI_BASE_URL"],
          message: "Azure OpenAI requires https://<resource>.openai.azure.com/openai/v1",
        });
    }
    if (
      env.NODE_ENV === "production" &&
      env.AI_PROVIDER === "openai" &&
      new URL(env.OPENAI_BASE_URL).hostname !== "api.openai.com"
    )
      ctx.addIssue({
        code: "custom",
        path: ["OPENAI_BASE_URL"],
        message: "Production OpenAI keys may only be sent to api.openai.com",
      });
  });

export type AppConfig = ReturnType<typeof parseEnv>;

export function parseEnv(input: NodeJS.ProcessEnv) {
  const parsed = envSchema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${message}`);
  }
  return {
    nodeEnv: parsed.data.NODE_ENV,
    appRole: parsed.data.APP_ROLE,
    port: parsed.data.PORT,
    baseUrl: parsed.data.BASE_URL.replace(/\/$/, ""),
    timezone: parsed.data.DEFAULT_TIMEZONE,
    logLevel: parsed.data.LOG_LEVEL,
    commitSha: parsed.data.COMMIT_SHA,
    databaseUrl: parsed.data.DATABASE_URL,
    directDatabaseUrl: parsed.data.DIRECT_DATABASE_URL,
    authMode: parsed.data.AUTH_MODE,
    localAdminEmail: parsed.data.LOCAL_ADMIN_EMAIL.toLowerCase(),
    bootstrapAdminEmails: parsed.data.BOOTSTRAP_ADMIN_EMAILS,
    autoProvisionUsers: parsed.data.AUTO_PROVISION_USERS,
    allowedEmailDomains: parsed.data.ALLOWED_EMAIL_DOMAINS,
    devBypassAuth: parsed.data.DEV_BYPASS_AUTH,
    sessionSecret: parsed.data.SESSION_SECRET,
    resendApiKey: parsed.data.RESEND_API_KEY,
    resendWebhookSecret: parsed.data.RESEND_WEBHOOK_SECRET,
    resendWebhookPreviousSecret: parsed.data.RESEND_WEBHOOK_PREVIOUS_SECRET,
    resendWebhookPreviousSecretExpiresAt: parsed.data.RESEND_WEBHOOK_PREVIOUS_SECRET_EXPIRES_AT,
    unsubscribeSigningSecret: parsed.data.UNSUBSCRIBE_SIGNING_SECRET,
    unsubscribePreviousSigningSecret: parsed.data.UNSUBSCRIBE_PREVIOUS_SIGNING_SECRET,
    unsubscribePreviousSigningSecretExpiresAt:
      parsed.data.UNSUBSCRIBE_PREVIOUS_SIGNING_SECRET_EXPIRES_AT,
    emailProvider: parsed.data.EMAIL_PROVIDER,
    deliveryMode: parsed.data.EMAIL_DELIVERY_MODE,
    testAllowlist: parsed.data.EMAIL_TEST_ALLOWLIST,
    storageProvider: parsed.data.STORAGE_PROVIDER,
    localAssetDir: parsed.data.LOCAL_ASSET_DIR,
    azureStorageAccountUrl: parsed.data.AZURE_STORAGE_ACCOUNT_URL,
    azureStorageContainer: parsed.data.AZURE_STORAGE_CONTAINER,
    azurePrivateContainer: parsed.data.AZURE_PRIVATE_CONTAINER,
    publicAssetBaseUrl: parsed.data.PUBLIC_ASSET_BASE_URL.replace(/\/$/, ""),
    companyName: parsed.data.COMPANY_NAME,
    companyPostalAddress: parsed.data.COMPANY_POSTAL_ADDRESS,
    companyWebsite: parsed.data.COMPANY_WEBSITE,
    applicationInsightsConnectionString: parsed.data.APPLICATIONINSIGHTS_CONNECTION_STRING,
    workerPollIntervalMs: parsed.data.WORKER_POLL_INTERVAL_MS,
    jobLockSeconds: parsed.data.JOB_LOCK_SECONDS,
    webhookRetentionDays: parsed.data.WEBHOOK_RETENTION_DAYS,
    auditRetentionDays: parsed.data.AUDIT_RETENTION_DAYS,
    oneKeyProvider: parsed.data.ONEKEY_PROVIDER,
    bboListingApiBaseUrl: parsed.data.BBO_LISTING_API_BASE_URL.replace(/\/$/, ""),
    bboMarketingApiKey: parsed.data.BBO_MARKETING_API_KEY,
    oneKeyMediaAllowedOrigins: parsed.data.ONEKEY_MEDIA_ALLOWED_ORIGINS,
    mlsGridBaseUrl: parsed.data.MLS_GRID_BASE_URL.replace(/\/$/, ""),
    mlsGridAccessToken: parsed.data.MLS_GRID_ACCESS_TOKEN,
    mlsGridOriginatingSystemName: parsed.data.MLS_GRID_ORIGINATING_SYSTEM_NAME,
    oneKeySyncEnabled: parsed.data.ONEKEY_SYNC_ENABLED,
    oneKeySyncPageSize: parsed.data.ONEKEY_SYNC_PAGE_SIZE,
    oneKeySyncStatuses: parsed.data.ONEKEY_SYNC_STATUSES.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    oneKeyMediaLimit: parsed.data.ONEKEY_MEDIA_LIMIT,
    aiProvider: parsed.data.AI_PROVIDER,
    openAiApiKey: parsed.data.OPENAI_API_KEY,
    openAiModel: parsed.data.OPENAI_MODEL,
    openAiBaseUrl: parsed.data.OPENAI_BASE_URL.replace(/\/$/, ""),
    aiRequestTimeoutMs: parsed.data.AI_REQUEST_TIMEOUT_MS,
    aiRateLimitPerHour: parsed.data.AI_RATE_LIMIT_PER_HOUR,
  } as const;
}

export const config = parseEnv(process.env);
