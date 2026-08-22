import { CampaignStatus, PermissionBasis, SuppressionReason } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { parseEnv } from "../../src/config/env.js";
import {
  createUnsubscribeToken,
  hashUnsubscribeToken,
  sanitizeIntro,
  unsubscribeHeaders,
  validateRenderedEmail,
  verifyUnsubscribeToken,
} from "../../src/email/compliance.js";
import { FakeEmailProvider } from "../../src/email/providers/FakeEmailProvider.js";
import { parseEasyAuthPrincipal } from "../../src/modules/auth/EasyAuthPrincipalParser.js";
import { createLocalSession, verifyLocalSession } from "../../src/modules/auth/session.js";
import { compileAudienceWhere } from "../../src/modules/audiences/domain.js";
import {
  assertCampaignTransition,
  isCampaignEditable,
} from "../../src/modules/campaigns/stateMachine.js";
import { detectAssetType } from "../../src/modules/assets/service.js";
import {
  effectiveDailyLimit,
  isInsideSendWindow,
  localDate,
  nextSendWindow,
  remainingQuota,
} from "../../src/modules/delivery/quota.js";
import {
  canRetry,
  classifyProviderFailure,
  retryDelayMs,
} from "../../src/modules/delivery/retry.js";
import { stricterSuppression } from "../../src/modules/suppressions/domain.js";
import {
  escapeCsvCell,
  normalizeEmail,
  normalizeName,
  sanitizeErrorMessage,
} from "../../src/shared/normalize.js";
import { audienceFilterSchema } from "../../src/shared/schemas.js";
import { serializeHttpRequest, serializeHttpResponse } from "../../src/web/app.js";

describe("normalization and safe exports", () => {
  it("logs only a query-free request path and never serializes headers", () => {
    const serialized = serializeHttpRequest({
      id: "request-1",
      method: "POST",
      url: "/api/public/unsubscribe/one-click?token=top-secret&email=private@example.com",
    });
    expect(serialized).toEqual({
      id: "request-1",
      method: "POST",
      path: "/api/public/unsubscribe/one-click",
    });
    expect(JSON.stringify(serialized)).not.toContain("top-secret");
    expect(JSON.stringify(serialized)).not.toContain("private@example.com");
    const response = { statusCode: 200, headers: { "set-cookie": "session-secret" } };
    expect(serializeHttpResponse(response)).toEqual({ statusCode: 200 });
    expect(JSON.stringify(serializeHttpResponse(response))).not.toContain("session-secret");
  });

  it("trims/lowercases email without removing plus addressing", () => {
    expect(normalizeEmail("  Team+LongIsland@Example.COM ")).toBe("team+longisland@example.com");
  });

  it("rejects invalid addresses and keeps Unicode values intact in CSV", () => {
    expect(() => normalizeEmail("not an email")).toThrow();
    expect(escapeCsvCell("李小明")).toBe('"李小明"');
    expect(escapeCsvCell('=HYPERLINK("bad")')).toBe('"\'=HYPERLINK(""bad"")"');
    expect(escapeCsvCell(null)).toBe('""');
    expect(normalizeName("  Long   Island  ")).toBe("long island");
    expect(sanitizeErrorMessage(new Error("re_secret postgresql://user:pass@db/name"))).toBe(
      "[REDACTED] [REDACTED]"
    );
    expect(sanitizeErrorMessage("unknown")).toBe("Unknown error");
  });
});

describe("audience DSL", () => {
  it("compiles deterministic AND conditions for include/exclude relationships", () => {
    const filter = audienceFilterSchema.parse({
      contactTypes: ["BROKER", "INVESTOR"],
      tagIdsAny: ["11111111-1111-4111-8111-111111111111"],
      tagIdsAll: ["22222222-2222-4222-8222-222222222222"],
      excludeTagIds: ["33333333-3333-4333-8333-333333333333"],
      marketIdsAny: ["44444444-4444-4444-8444-444444444444"],
      propertyInterestIdsAny: ["55555555-5555-4555-8555-555555555555"],
    });
    const first = compileAudienceWhere(filter);
    const second = compileAudienceWhere(filter);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toContain("markets");
    expect(JSON.stringify(first)).toContain("propertyInterests");
    expect(JSON.stringify(first)).toContain("none");
    expect(JSON.stringify(first)).toContain(PermissionBasis.UNKNOWN);
  });

  it("rejects arbitrary SQL-style fields and operators", () => {
    expect(() => audienceFilterSchema.parse({ rawSql: "DROP TABLE contacts" })).toThrow();
    expect(() => audienceFilterSchema.parse({ contactTypes: { $where: "1=1" } })).toThrow();
  });

  it("compiles every structured filter and supports non-live previews", () => {
    const full = audienceFilterSchema.parse({
      sourceTypes: ["REFERRAL"],
      permissionBases: ["BUSINESS_CONTACT"],
      includeContactIds: ["11111111-1111-4111-8111-111111111111"],
      excludeContactIds: ["22222222-2222-4222-8222-222222222222"],
      engagedWithinDays: 30,
      createdAfter: "2026-01-01T00:00:00.000Z",
      requireKnownPermissionBasis: false,
    });
    const where = compileAudienceWhere(full);
    expect(JSON.stringify(where)).toContain("REFERRAL");
    expect(JSON.stringify(where)).toContain("lastEngagedAt");
    expect(JSON.stringify(where)).not.toContain(PermissionBasis.UNKNOWN);

    const preview = compileAudienceWhere(audienceFilterSchema.parse({}), false);
    expect(JSON.stringify(preview)).not.toContain(PermissionBasis.UNKNOWN);
  });
});

describe("campaign state machine", () => {
  it("accepts the supported send lifecycle and locks frozen content", () => {
    expect(() =>
      assertCampaignTransition(CampaignStatus.DRAFT, CampaignStatus.READY)
    ).not.toThrow();
    expect(() =>
      assertCampaignTransition(CampaignStatus.SENDING, CampaignStatus.PAUSED)
    ).not.toThrow();
    expect(() =>
      assertCampaignTransition(CampaignStatus.PAUSED, CampaignStatus.SENDING)
    ).not.toThrow();
    expect(isCampaignEditable(CampaignStatus.READY)).toBe(true);
    expect(isCampaignEditable(CampaignStatus.SENDING)).toBe(false);
  });

  it("rejects skip-ahead, completed resume, and invalid cancel transitions", () => {
    expect(() => assertCampaignTransition(CampaignStatus.DRAFT, CampaignStatus.SENDING)).toThrow(
      /cannot transition/
    );
    expect(() =>
      assertCampaignTransition(CampaignStatus.COMPLETED, CampaignStatus.SENDING)
    ).toThrow(/cannot transition/);
    expect(() =>
      assertCampaignTransition(CampaignStatus.COMPLETED, CampaignStatus.CANCELLED)
    ).toThrow(/cannot transition/);
  });
});

describe("suppression, quota, and retry policy", () => {
  it("never downgrades a stronger suppression", () => {
    expect(stricterSuppression(SuppressionReason.COMPLAINT, SuppressionReason.MANUAL)).toBe(
      SuppressionReason.COMPLAINT
    );
    expect(stricterSuppression(SuppressionReason.MANUAL, SuppressionReason.UNSUBSCRIBE)).toBe(
      SuppressionReason.UNSUBSCRIBE
    );
    expect(
      stricterSuppression(SuppressionReason.LEGACY_BOUNCE_REVIEW, SuppressionReason.HARD_BOUNCE)
    ).toBe(SuppressionReason.HARD_BOUNCE);
  });

  it("calculates ET local dates across DST and enforces reservation totals", () => {
    expect(localDate(new Date("2026-03-08T06:30:00Z"), "America/New_York").toISOString()).toBe(
      "2026-03-08T00:00:00.000Z"
    );
    expect(localDate(new Date("2026-11-01T05:30:00Z"), "America/New_York").toISOString()).toBe(
      "2026-11-01T00:00:00.000Z"
    );
    expect(remainingQuota(100, 70, 40)).toBe(0);
    expect(remainingQuota(100, 25, 10)).toBe(65);
    expect(
      effectiveDailyLimit({
        dailyLimit: 500,
        warmupEnabled: true,
        warmupStartDate: new Date("2026-08-01T12:00:00Z"),
        warmupSchedule: [
          { day: 1, limit: 50 },
          { day: 8, limit: 200 },
        ],
        now: new Date("2026-08-10T12:00:00Z"),
        timezone: "America/New_York",
      })
    ).toBe(200);
    expect(
      isInsideSendWindow(
        new Date("2026-08-21T14:00:00Z"),
        "America/New_York",
        "08:00",
        "18:00",
        [1, 2, 3, 4, 5]
      )
    ).toBe(true);
    expect(
      isInsideSendWindow(
        new Date("2026-08-23T14:00:00Z"),
        "America/New_York",
        "08:00",
        "18:00",
        [1, 2, 3, 4, 5]
      )
    ).toBe(false);
    expect(
      nextSendWindow(
        new Date("2026-08-23T14:00:00Z"),
        "America/New_York",
        "08:00",
        "18:00",
        [1, 2, 3, 4, 5]
      ).toISOString()
    ).toBe("2026-08-24T12:00:00.000Z");
    expect(
      effectiveDailyLimit({
        dailyLimit: 500,
        warmupEnabled: false,
        warmupStartDate: null,
        warmupSchedule: [],
        now: new Date("2026-08-10T12:00:00Z"),
        timezone: "America/New_York",
      })
    ).toBe(500);
    expect(
      effectiveDailyLimit({
        dailyLimit: 100,
        warmupEnabled: true,
        warmupStartDate: new Date("2026-08-10T12:00:00Z"),
        warmupSchedule: [
          { day: 8, limit: 500 },
          { day: 1, limit: 25 },
        ],
        now: new Date("2026-08-10T12:00:00Z"),
        timezone: "America/New_York",
      })
    ).toBe(25);
  });

  it("classifies failure outcomes and bounds exponential jitter", () => {
    expect(classifyProviderFailure({ status: 429 })).toBe("temporary");
    expect(classifyProviderFailure({ status: 503 })).toBe("temporary");
    expect(classifyProviderFailure({})).toBe("temporary");
    expect(classifyProviderFailure({ status: 400, code: "application_error" })).toBe("temporary");
    expect(classifyProviderFailure({ status: 422 })).toBe("permanent");
    expect(classifyProviderFailure({ timedOutAfterSubmit: true })).toBe("uncertain");
    expect(retryDelayMs(2, undefined, () => 0)).toBe(48_000);
    expect(retryDelayMs(2, undefined, () => 1)).toBe(72_000);
    expect(retryDelayMs(9, 12)).toBe(12_000);
    expect(canRetry(3, 4, new Date(Date.now() + 60_000))).toBe(true);
    expect(canRetry(4, 4, new Date(Date.now() + 60_000))).toBe(false);
    expect(canRetry(1, 4, new Date(Date.now() - 60_000))).toBe(false);
  });
});

describe("security boundaries", () => {
  const secret = "a-development-secret-with-enough-bytes";

  it("signs sessions and unsubscribe links without accepting tampering", () => {
    const session = createLocalSession("Admin@HomixNY.com", secret);
    expect(verifyLocalSession(session, secret)).toEqual({ email: "admin@homixny.com" });
    expect(verifyLocalSession(`${session}x`, secret)).toBeNull();
    const unsubscribe = createUnsubscribeToken("11111111-1111-4111-8111-111111111111", secret);
    expect(verifyUnsubscribeToken(unsubscribe, secret)).toBe(
      "11111111-1111-4111-8111-111111111111"
    );
    expect(verifyUnsubscribeToken(`${unsubscribe}x`, secret)).toBeNull();
    expect(verifyUnsubscribeToken("invalid", secret)).toBeNull();
    expect(hashUnsubscribeToken(unsubscribe)).toHaveLength(64);
    expect(unsubscribeHeaders("https://example.com/one-click")).toEqual({
      "List-Unsubscribe": "<https://example.com/one-click>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("enforces rendered-email compliance checks", () => {
    const valid = {
      subject: "New listing",
      html: '<p>View it online.</p><a href="https://example.com/unsubscribe">Unsubscribe</a>',
      text: "View it online. Unsubscribe: https://example.com/unsubscribe",
      companyAddress: "123 Main Street, New York, NY 10001",
      live: true,
    };
    expect(() => validateRenderedEmail(valid)).not.toThrow();
    expect(() => validateRenderedEmail({ ...valid, subject: "" })).toThrow(/Subject/);
    expect(() => validateRenderedEmail({ ...valid, subject: "x".repeat(151) })).toThrow(/Subject/);
    expect(() => validateRenderedEmail({ ...valid, subject: "bad\nsubject" })).toThrow(/Subject/);
    expect(() => validateRenderedEmail({ ...valid, text: "" })).toThrow(/Plain-text/);
    expect(() =>
      validateRenderedEmail({ ...valid, companyAddress: "REQUIRED_BEFORE_LIVE_SEND" })
    ).toThrow(/postal address/);
    expect(() => validateRenderedEmail({ ...valid, html: "<p>No footer</p>" })).toThrow(
      /compliance/
    );
    expect(() =>
      validateRenderedEmail({ ...valid, html: "<p>unsubscribe javascript:bad</p>" })
    ).toThrow(/compliance/);
    expect(() =>
      validateRenderedEmail({ ...valid, html: "<p>unsubscribe {{missing}}</p>" })
    ).toThrow(/compliance/);
    expect(() =>
      validateRenderedEmail({ ...valid, html: "<p>unsubscribe http://localhost/link</p>" })
    ).toThrow(/local URLs/);
    expect(() =>
      validateRenderedEmail({
        ...valid,
        live: false,
        html: "<p>unsubscribe http://localhost/link</p>",
      })
    ).not.toThrow();
  });

  it("parses only valid Easy Auth principals", () => {
    const encoded = Buffer.from(
      JSON.stringify({
        claims: [
          { typ: "oid", val: "entra-object-id" },
          { typ: "preferred_username", val: "Admin@HomixNY.com" },
          { typ: "name", val: "Homix Admin" },
        ],
      })
    ).toString("base64");
    expect(parseEasyAuthPrincipal(encoded)).toEqual({
      objectId: "entra-object-id",
      email: "admin@homixny.com",
      displayName: "Homix Admin",
    });
    expect(() => parseEasyAuthPrincipal(Buffer.from("{}").toString("base64"))).toThrow();
  });

  it("forbids production local auth, bypass, and plaintext PostgreSQL", () => {
    const base = {
      DATABASE_URL: "postgresql://db/runtime",
      DIRECT_DATABASE_URL: "postgresql://db/admin",
      NODE_ENV: "production",
      AUTH_MODE: "local",
      DEV_BYPASS_AUTH: "true",
    } as NodeJS.ProcessEnv;
    expect(() => parseEnv(base)).toThrow(/Local auth is forbidden/);
    expect(() =>
      parseEnv({ ...base, AUTH_MODE: "azure-easyauth", DEV_BYPASS_AUTH: "false" })
    ).toThrow(/must require TLS/);
  });

  it("forbids local production storage and unsafe live-delivery identity", () => {
    const production = {
      DATABASE_URL: "postgresql://db/runtime?sslmode=require",
      DIRECT_DATABASE_URL: "postgresql://db/admin?sslmode=require",
      NODE_ENV: "production",
      AUTH_MODE: "azure-easyauth",
      STORAGE_PROVIDER: "local",
      SESSION_SECRET: "a-secure-production-session-secret",
    } as NodeJS.ProcessEnv;
    expect(() => parseEnv(production)).toThrow(/must use Azure Blob Storage/);

    const azure = {
      ...production,
      STORAGE_PROVIDER: "azure",
      AZURE_STORAGE_ACCOUNT_URL: "https://assets.blob.core.windows.net",
      EMAIL_DELIVERY_MODE: "live",
    };
    expect(() => parseEnv(azure)).toThrow(/real company postal address/);
    expect(() =>
      parseEnv({
        ...azure,
        COMPANY_POSTAL_ADDRESS: "123 Main Street, New York, NY 10001",
      })
    ).toThrow(/public application URL/);
  });

  it("sanitizes rich text and rejects SVG by magic bytes", () => {
    const cleaned = sanitizeIntro(
      '<p>Hello</p><script>alert(1)</script><a href="javascript:bad">bad</a>'
    );
    expect(cleaned).not.toMatch(/script|javascript/i);
    expect(detectAssetType(Buffer.from("<svg><script/></svg>"))).toBeNull();
    expect(detectAssetType(Buffer.from("../outside"))).toBeNull();
  });
});

describe("fake provider", () => {
  const message = {
    from: "Homix <listings@example.com>",
    to: "test@example.com",
    subject: "Test",
    html: "<p>Test</p>",
    text: "Test",
  };

  it("generates deterministic PII-free IDs and supports partial results", async () => {
    const provider = new FakeEmailProvider();
    const first = await provider.sendBatch([message, message], {
      idempotencyKey: "campaign/1/batch/1",
    });
    const second = await provider.sendBatch([message], { idempotencyKey: "campaign/1/batch/1" });
    expect(first.items[0]?.providerEmailId).toBe(second.items[0]?.providerEmailId);
    provider.mode = "partial";
    expect(
      (await provider.sendBatch([message, message], { idempotencyKey: "batch/2" })).items.map(
        (item) => item.accepted
      )
    ).toEqual([true, false]);
  });

  it("models retryable and uncertain provider failures", async () => {
    const provider = new FakeEmailProvider();
    provider.mode = "temporary";
    await expect(
      provider.sendBatch([message], { idempotencyKey: "batch/temp" })
    ).rejects.toMatchObject({ status: 429 });
    provider.mode = "uncertain";
    await expect(
      provider.sendBatch([message], { idempotencyKey: "batch/uncertain" })
    ).rejects.toMatchObject({ timedOutAfterSubmit: true });
  });
});
