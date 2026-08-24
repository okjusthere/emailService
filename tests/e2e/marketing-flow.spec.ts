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

  const oneKeySearchResponse = await api.get("/api/v2/onekey/listings/search?q=90000001");
  expect(oneKeySearchResponse.ok(), await oneKeySearchResponse.text()).toBeTruthy();
  const oneKeySearch = await oneKeySearchResponse.json();
  expect(oneKeySearch.items).toHaveLength(1);
  expect(oneKeySearch.items[0]).toMatchObject({
    sourceKey: "KEY900000001",
    listingId: "90000001",
    postalCode: "11354",
  });

  const listingResponse = await api.post(
    `/api/v2/onekey/listings/${oneKeySearch.items[0].sourceKey}/import`,
    {
      headers: csrf,
      data: { agentId: broker.id },
    }
  );
  expect(listingResponse.status()).toBe(201);
  const listingImport = await listingResponse.json();
  expect(listingImport.created).toBe(true);
  const listing = listingImport.listing;
  expect(listing).toMatchObject({
    source: "ONEKEY",
    sourceKey: "KEY900000001",
    status: "DRAFT",
    listingUrl: "https://www.homixny.com/listings",
  });

  await page.goto("/campaigns");
  await page.getByRole("button", { name: "New campaign" }).click();
  const importedListing = page.getByLabel("Choose an imported listing");
  await expect(importedListing.getByRole("option", { name: /DRAFT/ })).toContainText(listing.title);
  await importedListing.selectOption(listing.id);
  await expect(importedListing).toHaveValue(listing.id);
  await page.getByRole("button", { name: "Content" }).click();
  await expect(page.getByLabel("CTA URL")).toHaveValue("https://www.homixny.com/listings");

  const listingReview = await api.get(`/api/v2/onekey/listings/${listing.sourceKey}`);
  expect(listingReview.ok(), await listingReview.text()).toBeTruthy();
  expect((await listingReview.json()).sourceFacts).toMatchObject({
    listingId: "90000001",
    address: "136-20 Roosevelt Ave, Flushing, NY 11354",
  });

  const listingAiResponse = await api.post(`/api/v2/listings/${listing.id}/ai/generate`, {
    headers: csrf,
    data: { tone: "professional" },
  });
  expect(listingAiResponse.ok(), await listingAiResponse.text()).toBeTruthy();
  const listingAi = await listingAiResponse.json();
  expect(listingAi.proposal.highlights).toHaveLength(3);
  const listingApplyResponse = await api.post(`/api/v2/listings/${listing.id}/ai/apply`, {
    headers: csrf,
    data: {
      generationId: listingAi.generationId,
      fields: ["title", "shortDescription", "longDescription", "highlights"],
    },
  });
  expect(listingApplyResponse.ok(), await listingApplyResponse.text()).toBeTruthy();
  expect((await listingApplyResponse.json()).title).toContain("136-20 Roosevelt Ave");

  const recipientPreview = await api.get(
    `/api/v2/onekey/listings/${listing.sourceKey}/recipients?nearbyZipCount=3&closedMonths=12&limit=100`
  );
  expect(recipientPreview.ok(), await recipientPreview.text()).toBeTruthy();
  expect((await recipientPreview.json()).recipients[0]).toMatchObject({
    email: "external-agent@example.com",
    matchedSameZip: true,
  });
  const recipientImport = await api.post(
    `/api/v2/listings/${listing.id}/onekey/recipients/import`,
    {
      headers: csrf,
      data: {
        nearbyZipCount: 3,
        closedMonths: 12,
        limit: 100,
        audienceName: `OneKey matches ${unique}`,
      },
    }
  );
  expect(recipientImport.status()).toBe(201);
  expect(await recipientImport.json()).toMatchObject({ created: 1, suppressed: 0 });

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
    data: {
      status: "ACTIVE",
      listingUrl: "https://homixny.com/listings/roosevelt-avenue",
    },
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
      name: `Roosevelt launch ${unique}`,
      listingId: listing.id,
      senderProfileId: sender.id,
      replyToAgentId: broker.id,
      savedAudienceId: audience.id,
      templateKey: "LISTING_BRANDED",
      subject: "{{first_name}}, a new Flushing opportunity",
      preheader: "A new OneKey listing from Homix Realty",
      introHtml: "<p>I wanted to share this new opportunity with you.</p>",
      ctaLabel: "View listing",
      ctaUrl: "https://homixny.com/listings/roosevelt-avenue",
      audienceFilter: audience.filter,
      timezone: "America/New_York",
    },
  });
  expect(campaignResponse.ok()).toBeTruthy();
  const campaign = await campaignResponse.json();
  const campaignAiResponse = await api.post(`/api/v2/campaigns/${campaign.id}/ai/generate`, {
    headers: csrf,
    data: { tone: "warm" },
  });
  expect(campaignAiResponse.ok(), await campaignAiResponse.text()).toBeTruthy();
  const campaignAi = await campaignAiResponse.json();
  expect(campaignAi.proposal.variants).toHaveLength(3);
  const campaignAiApplyResponse = await api.post(`/api/v2/campaigns/${campaign.id}/ai/apply`, {
    headers: csrf,
    data: {
      generationId: campaignAi.generationId,
      variantIndex: campaignAi.proposal.recommendedIndex,
      fields: ["subject", "preheader", "introText", "ctaLabel"],
    },
  });
  expect(campaignAiApplyResponse.ok(), await campaignAiApplyResponse.text()).toBeTruthy();
  const campaignAfterAi = await campaignAiApplyResponse.json();
  expect(campaignAfterAi.subject).toContain("136-20 Roosevelt Ave");
  const preview = await (
    await api.post(`/api/v2/campaigns/${campaign.id}/preview`, {
      headers: csrf,
      data: { firstName: "Avery" },
    })
  ).json();
  expect(preview.html).toContain("136-20 Roosevelt Ave");
  expect(
    (
      await api.post(`/api/v2/campaigns/${campaign.id}/test-send`, {
        headers: csrf,
        data: {
          email: "admin@homixny.com",
          version: campaignAfterAi.version,
          clientRequestId: randomUUID(),
        },
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
        data: { version: campaignAfterAi.version },
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
  await expect(page.getByText(`Roosevelt launch ${unique}`)).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: `Roosevelt launch ${unique}` })
  ).toContainText("COMPLETED");

  const raw = `${accepted.id}.${createHmac("sha256", "playwright-unsubscribe-secret-at-least-thirty-two-bytes").update(accepted.id).digest("base64url")}`;
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

test("searches the populated OneKey index by address and reuses the imported listing", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Continue" }).click();
  const api = page.request;
  await expect.poll(async () => (await api.get("/api/v2/auth/me")).status()).toBe(200);

  const search = await api.get(
    `/api/v2/onekey/listings/search?q=${encodeURIComponent("136-20 Roosevelt Ave")}`
  );
  expect(search.ok(), await search.text()).toBeTruthy();
  const result = await search.json();
  expect(result.source).toBe("local");
  expect(result.items[0]).toMatchObject({
    sourceKey: "KEY900000001",
    importedListingId: expect.stringMatching(/[0-9a-f-]{36}/),
  });

  const agents = await api.get("/api/v2/agents?limit=1");
  expect(agents.ok(), await agents.text()).toBeTruthy();
  const agentId = (await agents.json()).items[0].id;
  const reused = await api.post(`/api/v2/onekey/listings/KEY900000001/import`, {
    headers: csrf,
    data: { agentId },
  });
  expect(reused.status()).toBe(200);
  expect(await reused.json()).toMatchObject({ created: false });
});
