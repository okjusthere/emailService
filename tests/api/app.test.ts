import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/web/app.js";
import { prisma } from "../../src/db/prisma.js";

const origin = "http://localhost:3000";
const mutationHeaders = { Origin: origin, "X-Homix-CSRF": "1" };

describe("HTTP security and API contract", () => {
  const app = createApp();
  const agent = request.agent(app);

  beforeAll(async () => {
    await prisma.emailEvent.deleteMany({ where: { webhookId: "webhook-api-test" } });
    await prisma.user.upsert({
      where: { emailNormalized: "admin@homixny.com" },
      create: {
        email: "admin@homixny.com",
        emailNormalized: "admin@homixny.com",
        displayName: "Test Admin",
        role: "ADMIN",
      },
      update: { role: "ADMIN", isActive: true },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("keeps liveness public and independent of auth", async () => {
    const response = await request(app).get("/health/live");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: "ok", role: "web", version: "2.0.0" });
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("rejects anonymous access and ignores forged Azure headers in local mode", async () => {
    await request(app).get("/api/v2/contacts").expect(401);
    const principal = Buffer.from(
      JSON.stringify({
        claims: [
          { typ: "oid", val: "forged" },
          { typ: "preferred_username", val: "admin@homixny.com" },
        ],
      })
    ).toString("base64");
    await request(app).get("/api/v2/contacts").set("X-MS-CLIENT-PRINCIPAL", principal).expect(401);
  });

  it("enforces same-origin CSRF before local login", async () => {
    await request(app)
      .post("/api/v2/auth/dev-login")
      .send({ email: "admin@homixny.com" })
      .expect(403);
    await request(app)
      .post("/api/v2/auth/dev-login")
      .set(mutationHeaders)
      .send({ email: "admin@homixny.com" })
      .expect(200);
    const me = await agent
      .post("/api/v2/auth/dev-login")
      .set(mutationHeaders)
      .send({ email: "admin@homixny.com" })
      .expect(200);
    expect(me.body.user.role).toBe("ADMIN");
    await agent.get("/api/v2/auth/me").expect(200);
  });

  it("enforces database roles rather than client-provided roles", async () => {
    const user = await prisma.user.update({
      where: { emailNormalized: "admin@homixny.com" },
      data: { role: "VIEWER" },
    });
    await agent
      .post("/api/v2/agents")
      .set(mutationHeaders)
      .send({
        firstName: "A",
        lastName: "Broker",
        displayName: "A Broker",
        email: "broker@example.com",
      })
      .expect(403);
    await prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
  });

  it("verifies the untouched raw webhook body and deduplicates replay", async () => {
    const body = JSON.stringify({
      type: "unknown.future_event",
      created_at: "2026-08-21T12:00:00.000Z",
    });
    await request(app)
      .post("/api/public/webhooks/resend")
      .set("Content-Type", "application/json")
      .set("svix-id", "webhook-api-test")
      .set("svix-signature", "invalid")
      .send(body)
      .expect(401);
    const first = await request(app)
      .post("/api/public/webhooks/resend")
      .set("Content-Type", "application/json")
      .set("svix-id", "webhook-api-test")
      .set("svix-signature", "fake-valid")
      .send(body)
      .expect(200);
    expect(first.body.duplicate).toBe(false);
    const replay = await request(app)
      .post("/api/public/webhooks/resend")
      .set("Content-Type", "application/json")
      .set("svix-id", "webhook-api-test")
      .set("svix-signature", "fake-valid")
      .send(body)
      .expect(200);
    expect(replay.body.duplicate).toBe(true);
  });

  it("returns safe public unsubscribe and API error responses", async () => {
    const invalid = await request(app)
      .post("/api/public/unsubscribe/one-click?token=invalid-token-that-is-long-enough")
      .expect(400);
    expect(invalid.type).toMatch(/json/);
    await request(app).get("/api/does-not-exist").expect("Content-Type", /json/).expect(404);
  });

  it("records successful administrative mutations and escapes CSV formulas", async () => {
    const tagName = `API Test ${Date.now()}`;
    await agent
      .post("/api/v2/tags")
      .set(mutationHeaders)
      .send({ name: tagName, color: "#123456" })
      .expect(201);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(
      await prisma.auditLog.count({ where: { action: "http.mutation", entityType: "api_request" } })
    ).toBeGreaterThan(0);

    await agent
      .post("/api/v2/contacts")
      .set(mutationHeaders)
      .send({
        email: `formula-${Date.now()}@example.com`,
        displayName: "=2+2",
        sourceType: "MANUAL",
        permissionBasis: "BUSINESS_CONTACT",
        contactType: "OTHER",
      })
      .expect(201);
    const csv = await agent.get("/api/v2/contacts/export").expect(200);
    expect(csv.text).toContain("'=2+2");

    const exportMarker = `export-${Date.now()}`;
    await prisma.contact.createMany({
      data: Array.from({ length: 105 }, (_, index) => ({
        email: `${exportMarker}-${index}@example.com`,
        emailNormalized: `${exportMarker}-${index}@example.com`,
        sourceType: "MANUAL",
        permissionBasis: "BUSINESS_CONTACT",
        contactType: "OTHER",
      })),
    });
    const completeCsv = await agent
      .get(`/api/v2/contacts/export?search=${exportMarker}`)
      .expect(200);
    expect(completeCsv.text.trim().split("\n")).toHaveLength(106);
  });

  it("paginates by cursor and rejects an SVG upload regardless of its filename", async () => {
    const unique = Date.now().toString(36);
    const contactIds: string[] = [];
    for (const suffix of ["a", "b"]) {
      const created = await agent
        .post("/api/v2/contacts")
        .set(mutationHeaders)
        .send({
          email: `cursor-${unique}-${suffix}@example.com`,
          sourceType: "MANUAL",
          permissionBasis: "BUSINESS_CONTACT",
          contactType: "OTHER",
        })
        .expect(201);
      contactIds.push(created.body.id);
    }
    await prisma.contact.update({
      where: { id: contactIds[0] },
      data: { lastEngagedAt: new Date("2026-08-21T12:00:00.000Z") },
    });
    const first = await agent
      .get(`/api/v2/contacts?limit=1&search=cursor-${unique}&sort=lastEngagedAt&order=desc`)
      .expect(200);
    expect(first.body.items).toHaveLength(1);
    expect(first.body.items[0].id).toBe(contactIds[0]);
    expect(first.body.nextCursor).toMatch(/[0-9a-f-]{36}/);
    const second = await agent
      .get(
        `/api/v2/contacts?limit=1&search=cursor-${unique}&sort=lastEngagedAt&order=desc&cursor=${first.body.nextCursor}`
      )
      .expect(200);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.items[0].id).toBe(contactIds[1]);

    const broker = await agent
      .post("/api/v2/agents")
      .set(mutationHeaders)
      .send({
        firstName: "Upload",
        lastName: "Guard",
        displayName: `Upload Guard ${unique}`,
        email: `upload-${unique}@example.com`,
      })
      .expect(201);
    const listing = await agent
      .post("/api/v2/listings")
      .set(mutationHeaders)
      .send({
        internalName: `Upload guard ${unique}`,
        title: `Upload guard ${unique}`,
        slug: `upload-guard-${unique}`,
        status: "DRAFT",
        transactionType: "FOR_SALE",
        propertyType: "OFFICE",
        addressLine1: "1 Security Way",
        city: "Huntington",
        stateCode: "NY",
        postalCode: "11743",
        askingPrice: "1",
        agentId: broker.body.id,
      })
      .expect(201);
    await agent
      .post(`/api/v2/listings/${listing.body.id}/assets`)
      .set(mutationHeaders)
      .field("kind", "HERO")
      .attach("file", Buffer.from("<svg><script>alert(1)</script></svg>"), {
        filename: "photo.png",
        contentType: "image/png",
      })
      .expect(415);
  });
});
