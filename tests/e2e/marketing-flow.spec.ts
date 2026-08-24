import { createHmac, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

const csrf = { Origin: "http://127.0.0.1:3000", "X-Homix-CSRF": "1" };

test("admin completes a listing campaign and observes delivery", async ({ page }) => {
  const unique = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Create a listing email" })).toBeVisible();

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

  await page.goto("/");
  await page.getByLabel("MLS number or address").fill("90000001");
  await page.getByRole("button", { name: "Find property" }).click();
  await expect(page.getByRole("heading", { name: listing.title })).toBeVisible();

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
  await page.getByRole("tab", { name: "Sent" }).click();
  await expect(page.getByText(`Roosevelt launch ${unique}`)).toBeVisible();
  await expect(
    page.getByRole("link").filter({ hasText: `Roosevelt launch ${unique}` })
  ).toContainText("Sent");

  const raw = `${accepted.id}.${createHmac("sha256", "playwright-unsubscribe-secret-at-least-thirty-two-bytes").update(accepted.id).digest("base64url")}`;
  const token = Buffer.from(raw).toString("base64url");
  await page.goto(`/unsubscribe?token=${encodeURIComponent(token)}`);
  await expect(page.getByRole("heading", { name: "Stop marketing emails?" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm unsubscribe" }).click();
  await expect(page.getByRole("heading", { name: "You’re unsubscribed" })).toBeVisible();

  await page.setViewportSize({ width: 700, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("link", { name: "Home" })).toBeVisible();
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

test("completes the simplified listing email composer on desktop and mobile", async ({ page }) => {
  await page.route("**/api/v2/ai/status", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        enabled: true,
        provider: "azure-openai",
        model: "production-copy",
        productionReady: true,
        mode: "production",
      }),
    });
  });
  await page.route("**/api/v2/campaigns/*/ai/generate", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    await route.continue();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Create a listing email" })).toBeVisible();
  await page.screenshot({ path: "artifacts/screenshots/home-empty.png", fullPage: true });

  await page.getByLabel("MLS number or address").fill("90000001");
  await page.getByRole("button", { name: "Find property" }).click();
  await expect(page.getByRole("button", { name: /Use this property/ })).toBeVisible();
  await page.screenshot({ path: "artifacts/screenshots/home-search-results.png", fullPage: true });
  await page.getByRole("button", { name: /Use this property/ }).click();
  await expect(page.getByRole("heading", { name: "Create listing email" })).toBeVisible();
  await page.screenshot({ path: "artifacts/screenshots/composer-desktop.png", fullPage: true });
  await expect(page.getByText("Writing your email…")).toBeVisible();
  await page.screenshot({ path: "artifacts/screenshots/composer-ai-writing.png", fullPage: true });
  await expect(page.getByText(/AI draft — review before sending/)).toBeVisible();

  await page.getByRole("button", { name: "Suggest recipients" }).click();
  await expect(page.getByText(/people ready/)).toBeVisible();
  const subject = page.getByLabel("Subject");
  await subject.fill(`Simplified composer ${Date.now()}`);
  await page.waitForTimeout(1_100);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Send test to/ }).click();
  await expect(page.locator(".test-status")).toContainText("Test sent to admin@homixny.com");
  await page.screenshot({
    path: "artifacts/screenshots/composer-test-complete.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".app-sidebar")).not.toHaveClass(/open/);
  await expect
    .poll(() =>
      page.locator(".app-sidebar").evaluate((element) => element.getBoundingClientRect().right)
    )
    .toBeLessThanOrEqual(0);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "Show" }).click();
  await expect(page.getByTitle("Email preview")).toBeVisible();
  await page.screenshot({ path: "artifacts/screenshots/composer-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1_000 });

  const reviewButton = page.getByRole("button", { name: "Review & send" });
  await reviewButton.click();
  await expect(page.getByRole("heading", { name: "Ready to send?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Ready to send?" })).toBeHidden();
  await expect(reviewButton).toBeFocused();
  await reviewButton.click();
  await expect(page.getByRole("button", { name: "Close" })).toBeFocused();
  await page.screenshot({ path: "artifacts/screenshots/send-review-dialog.png", fullPage: true });
  await page.getByRole("button", { name: /Send to 1 recipients/ }).click();
  await page.screenshot({ path: "artifacts/screenshots/campaign-sending.png", fullPage: true });
  await expect(page.getByText("Sent")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("External Agent")).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: "artifacts/screenshots/campaign-completed.png", fullPage: true });

  await page.goto("/contacts");
  await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();
  await page.screenshot({ path: "artifacts/screenshots/contacts.png", fullPage: true });
  await page.goto("/settings/operations");
  await expect(page.getByRole("heading", { name: "Operations" })).toBeVisible();
  await page.screenshot({ path: "artifacts/screenshots/settings-operations.png", fullPage: true });
});

test("keeps the fallback draft, restores autosave, and schedules a saved list", async ({
  page,
}) => {
  await page.route("**/api/v2/ai/status", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ enabled: false, productionReady: false, mode: "disabled" }),
    })
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("MLS number or address").fill("90000001");
  await page.getByRole("button", { name: "Find property" }).click();
  await page.getByRole("button", { name: /Use this property/ }).click();
  await expect(page.getByRole("heading", { name: "Create listing email" })).toBeVisible();
  await expect(page.getByLabel("Subject")).toHaveValue(/New listing:/i);

  await page.getByRole("tab", { name: "Saved contact list" }).click();
  const list = page.getByLabel("Saved list");
  await list.selectOption({ index: 1 });
  await expect(page.getByRole("button", { name: "Send test to me" })).toBeEnabled();
  const restoredSubject = `Saved schedule ${Date.now()}`;
  await page.getByLabel("Subject").fill(restoredSubject);
  const campaignId = page.url().match(/campaigns\/([^/]+)/)?.[1];
  expect(campaignId).toBeTruthy();
  await expect
    .poll(
      async () => (await (await page.request.get(`/api/v2/campaigns/${campaignId}`)).json()).subject
    )
    .toBe(restoredSubject);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Subject")).toHaveValue(restoredSubject);
  await page.getByRole("button", { name: "Send test to me" }).click();
  await expect(page.locator(".test-status")).toContainText("Test sent to admin@homixny.com");
  await page.getByRole("button", { name: "Review & send" }).click();
  await page.getByLabel("Schedule for later").check();
  const tomorrow = new Date(Date.now() + 86_400_000);
  tomorrow.setHours(10, 0, 0, 0);
  const local = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}T10:00`;
  await page.getByLabel("Send date and time").fill(local);
  await page.getByRole("button", { name: "Schedule email" }).click();
  await expect(page.locator(".status-badge")).toHaveText("Scheduled", { timeout: 10_000 });
});
