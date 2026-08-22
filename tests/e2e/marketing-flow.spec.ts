import { createHmac, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

const csrf = { Origin: "http://127.0.0.1:3000", "X-Homix-CSRF": "1" };

test("admin completes a listing campaign and observes delivery", async ({ page }) => {
  const unique = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Listing campaigns/ })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Marketing desk" })).toBeVisible();

  const api = page.request;
  await expect.poll(async () => (await api.get("/api/v2/auth/me")).status()).toBe(200);
  const suppressionResponse = await api.get("/api/v2/suppressions?limit=100");
  expect(suppressionResponse.ok(), await suppressionResponse.text()).toBeTruthy();
  const suppressions = await suppressionResponse.json();
  const priorE2eSuppression = suppressions.items.find(
    (item: { emailNormalized: string; isActive: boolean }) =>
      item.emailNormalized === "e2e-recipient@homixny.com" && item.isActive
  );
  if (priorE2eSuppression) {
    expect(
      (
        await api.post(`/api/v2/suppressions/${priorE2eSuppression.id}/release`, {
          headers: csrf,
          data: { reason: "Reset isolated Playwright acceptance fixture" },
        })
      ).ok()
    ).toBeTruthy();
  }
  const agentResponse = await api.post("/api/v2/agents", {
    headers: csrf,
    data: {
      firstName: "Jordan",
      lastName: "Lee",
      displayName: `Jordan Lee ${unique}`,
      email: `agent-${unique}@example.com`,
      title: "Licensed Associate Broker",
    },
  });
  expect(agentResponse.ok()).toBeTruthy();
  const broker = await agentResponse.json();

  const senderResponse = await api.post("/api/v2/sender-profiles", {
    headers: csrf,
    data: {
      name: `E2E Sender ${unique}`,
      fromName: "Homix Listings",
      fromEmail: `listings-${unique}@example.com`,
      domain: "example.com",
      fixedReplyToEmail: broker.email,
      dailyLimit: 100,
      batchSize: 20,
      minBatchIntervalSeconds: 1,
      timezone: "America/New_York",
      sendWindowStart: "00:00",
      sendWindowEnd: "23:59",
      allowedWeekdays: [0, 1, 2, 3, 4, 5, 6],
      warmupEnabled: false,
    },
  });
  expect(senderResponse.ok()).toBeTruthy();
  const sender = await senderResponse.json();
  expect(
    (
      await api.post(`/api/v2/sender-profiles/${sender.id}/verify`, {
        headers: csrf,
        data: { confirmation: "RESEND_DOMAIN_VERIFIED" },
      })
    ).ok()
  ).toBeTruthy();

  const csv = Buffer.from(
    "email,name,company,contact_type,permission_basis,tags\ne2e-recipient@homixny.com,E2E Recipient,Homix,BROKER,BUSINESS_CONTACT,E2E\n"
  );
  const upload = await api.post("/api/v2/contact-imports/upload", {
    headers: csrf,
    multipart: {
      file: { name: "contacts.csv", mimeType: "text/csv", buffer: csv },
      sourceType: "CRM_IMPORT",
      permissionBasis: "BUSINESS_CONTACT",
      sourceDetail: "Playwright acceptance",
    },
  });
  expect(upload.ok()).toBeTruthy();
  const contactImport = await upload.json();
  expect(
    (await api.post(`/api/v2/contact-imports/${contactImport.id}/validate`, { headers: csrf })).ok()
  ).toBeTruthy();
  expect(
    (
      await api.post(`/api/v2/contact-imports/${contactImport.id}/apply`, {
        headers: csrf,
        data: { confirmCreateUnknownReferences: true },
      })
    ).status()
  ).toBe(202);
  await expect
    .poll(
      async () =>
        (await (await api.get(`/api/v2/contact-imports/${contactImport.id}`)).json()).status
    )
    .toBe("COMPLETED");

  const listingResponse = await api.post("/api/v2/listings", {
    headers: csrf,
    data: {
      internalName: `E2E Harbor ${unique}`,
      title: `Harbor Avenue ${unique}`,
      slug: `harbor-avenue-${unique}`,
      status: "DRAFT",
      transactionType: "FOR_SALE",
      propertyType: "RETAIL",
      addressLine1: "42 Harbor Avenue",
      city: "Huntington",
      stateCode: "NY",
      postalCode: "11743",
      askingPrice: "2450000",
      buildingSqFt: 8500,
      shortDescription: "Waterfront retail investment",
      highlights: ["8,500 SF", "Waterfront access"],
      listingUrl: "https://homixny.com/listings/harbor",
      agentId: broker.id,
    },
  });
  expect(listingResponse.ok()).toBeTruthy();
  const listing = await listingResponse.json();
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
  const asset = await api.post(`/api/v2/listings/${listing.id}/assets`, {
    headers: csrf,
    multipart: {
      file: { name: "hero.png", mimeType: "image/png", buffer: png },
      kind: "HERO",
      altText: "Harbor Avenue exterior",
    },
  });
  expect(asset.ok()).toBeTruthy();
  const activation = await api.patch(`/api/v2/listings/${listing.id}`, {
    headers: csrf,
    data: { status: "ACTIVE" },
  });
  expect(activation.ok(), await activation.text()).toBeTruthy();

  const audienceResponse = await api.post("/api/v2/audiences", {
    headers: csrf,
    data: {
      name: `Known contacts ${unique}`,
      description: "Safe E2E audience",
      filter: { requireKnownPermissionBasis: true },
    },
  });
  expect(audienceResponse.ok()).toBeTruthy();
  const audience = await audienceResponse.json();
  const estimate = await (
    await api.post("/api/v2/audiences/estimate", { headers: csrf, data: audience.filter })
  ).json();
  expect(estimate.eligible).toBeGreaterThan(0);

  const campaignResponse = await api.post("/api/v2/campaigns", {
    headers: csrf,
    data: {
      name: `Harbor launch ${unique}`,
      listingId: listing.id,
      senderProfileId: sender.id,
      replyToAgentId: broker.id,
      savedAudienceId: audience.id,
      templateKey: "LISTING_BRANDED",
      subject: "{{first_name}}, a new Huntington opportunity",
      preheader: "Waterfront retail from Homix Realty",
      introHtml: "<p>I wanted to share this new opportunity with you.</p>",
      ctaLabel: "View listing",
      ctaUrl: "https://homixny.com/listings/harbor",
      audienceFilter: audience.filter,
      timezone: "America/New_York",
    },
  });
  expect(campaignResponse.ok()).toBeTruthy();
  const campaign = await campaignResponse.json();
  const preview = await (
    await api.post(`/api/v2/campaigns/${campaign.id}/preview`, {
      headers: csrf,
      data: { firstName: "Avery" },
    })
  ).json();
  expect(preview.html).toContain("Harbor Avenue");
  expect(
    (
      await api.post(`/api/v2/campaigns/${campaign.id}/test-send`, {
        headers: csrf,
        data: { email: "admin@homixny.com", version: campaign.version },
      })
    ).ok()
  ).toBeTruthy();
  expect(
    (await api.post(`/api/v2/campaigns/${campaign.id}/mark-ready`, { headers: csrf })).ok()
  ).toBeTruthy();
  expect(
    (
      await api.post("/api/v2/system/sending/resume", {
        headers: csrf,
        data: {
          reason: "Playwright fixture state reconciled before delivery",
          recoveryReconciled: true,
        },
      })
    ).ok()
  ).toBeTruthy();
  expect(
    (
      await api.post(`/api/v2/campaigns/${campaign.id}/send-now`, {
        headers: { ...csrf, "Idempotency-Key": `e2e-${unique}` },
        data: { version: campaign.version },
      })
    ).ok()
  ).toBeTruthy();

  await expect
    .poll(async () => (await (await api.get(`/api/v2/campaigns/${campaign.id}`)).json()).status, {
      timeout: 20_000,
    })
    .toBe("COMPLETED");
  const recipients = await (
    await api.get(`/api/v2/campaigns/${campaign.id}/recipients?limit=100`)
  ).json();
  const accepted = recipients.items.find(
    (item: { emailNormalized: string; sendState: string }) =>
      item.emailNormalized === "e2e-recipient@homixny.com" && item.sendState === "ACCEPTED"
  );
  expect(accepted).toBeTruthy();

  const webhookId = `e2e-webhook-${unique}`;
  const webhook = await api.post("/api/public/webhooks/resend", {
    headers: {
      "Content-Type": "application/json",
      "svix-id": webhookId,
      "svix-signature": "fake-valid",
    },
    data: {
      type: "email.delivered",
      created_at: new Date().toISOString(),
      email_id: accepted.resendEmailId,
      recipient: accepted.email,
    },
  });
  expect(webhook.ok()).toBeTruthy();
  await expect
    .poll(
      async () =>
        (await (await api.get(`/api/v2/campaigns/${campaign.id}/recipients/${accepted.id}`)).json())
          .deliveryState
    )
    .toBe("DELIVERED");

  await page.goto("/campaigns");
  await expect(page.getByText(`Harbor launch ${unique}`)).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: `Harbor launch ${unique}` })).toContainText(
    "COMPLETED"
  );

  const raw = `${accepted.id}.${createHmac("sha256", "playwright-session-secret-at-least-sixteen-bytes").update(accepted.id).digest("base64url")}`;
  const token = Buffer.from(raw).toString("base64url");
  await page.goto(`/unsubscribe?token=${encodeURIComponent(token)}`);
  await expect(page.getByRole("heading", { name: "Stop marketing emails?" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm unsubscribe" }).click();
  await expect(page.getByRole("heading", { name: "You’re unsubscribed" })).toBeVisible();

  await page.setViewportSize({ width: 700, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("link", { name: "Listings" })).toBeVisible();
});
