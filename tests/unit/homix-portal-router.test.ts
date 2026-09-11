import { beforeEach, describe, it, expect, vi } from "vitest";
import { createHash, createHmac, randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
const fake = vi.hoisted(() => ({
  findFirst: vi.fn(),
  deleteDraft: vi.fn(),
  audit: vi.fn(),
  findMany: vi.fn(),
  userFind: vi.fn(),
  userUpdate: vi.fn(),
  userCreate: vi.fn(),
  execute: vi.fn(),
  preview: vi.fn(),
  testSend: vi.fn(),
  publish: vi.fn(),
  transition: vi.fn(),
}));
vi.mock("../../src/db/prisma.js", () => {
  const tx = {
    user: { findUnique: fake.userFind, update: fake.userUpdate, create: fake.userCreate },
    $executeRaw: fake.execute,
    campaign: { updateMany: fake.deleteDraft },
  };
  return {
    prisma: {
      ...tx,
      $transaction: (fn: (value: unknown) => unknown) => fn(tx),
      campaign: { findFirst: fake.findFirst, findMany: fake.findMany },
    },
  };
});
vi.mock("../../src/modules/audit/service.js", () => ({ writeAudit: fake.audit }));
vi.mock("../../src/modules/campaigns/service.js", () => ({
  quickStartCampaign: vi.fn(),
  updateCampaign: vi.fn(),
  previewCampaign: fake.preview,
  testSendCampaign: fake.testSend,
  publishCampaign: fake.publish,
  transitionCampaign: fake.transition,
}));
vi.mock("../../src/modules/onekey/service.js", () => ({
  searchOneKeyListings: vi.fn(),
  importOneKeyListing: vi.fn(),
  configureCampaignOneKeyRecipients: vi.fn(),
}));
vi.mock("../../src/modules/ai/service.js", () => ({
  generateCampaignCopy: vi.fn(),
  applyCampaignCopy: vi.fn(),
}));
import { homixRouter } from "../../src/web/routes/homix.js";
import { errorHandler } from "../../src/shared/errors.js";
const secret = "router-test-signing-key-at-least-32-characters",
  id = "f717651f-27b6-439d-a250-b0057caf63fb";
const prefix = "/api/integrations/homix/v1";
const brand = {
  agentId: 42,
  name: "Portal Agent",
  email: "agent@example.com",
  phone: "",
  title: "",
  licenseNumber: "",
  companyId: "homix_realty",
  companyName: "Homix Realty",
  photoUrl: null,
};
function token(method: string, path: string, body: unknown, admin = false) {
  const now = Math.floor(Date.now() / 1000),
    header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    payload = Buffer.from(
      JSON.stringify({
        iss: "homixliving",
        aud: "email-service",
        sub: "42",
        iat: now,
        exp: now + 90,
        jti: randomUUID(),
        admin,
        email: brand.email,
        brand,
        method,
        path: prefix + path,
        bodyHash: createHash("sha256")
          .update(method === "GET" ? "" : JSON.stringify(body))
          .digest("hex"),
      })
    ).toString("base64url"),
    input = `${header}.${payload}`;
  return `${input}.${createHmac("sha256", secret).update(input).digest("base64url")}`;
}
const app = express();
app.use(express.json());
app.use(prefix, homixRouter);
app.use(errorHandler);
describe("Portal receiver ownership boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HOMIX_PORTAL_INTEGRATION_SECRET = secret;
    const user = {
      id: "mapped-user",
      portalAgentId: 42,
      email: brand.email,
      emailNormalized: brand.email,
      displayName: brand.name,
      isActive: true,
      role: "MARKETER",
    };
    fake.userFind.mockResolvedValue(user);
    fake.userUpdate.mockResolvedValue(user);
    fake.findFirst.mockResolvedValue(null);
    fake.findMany.mockResolvedValue([]);
  });
  it("does not expose legacy or another Agent's campaign", async () => {
    const path = `/campaigns/${id}`;
    await request(app)
      .get(prefix + path)
      .set("Authorization", `Bearer ${token("GET", path, undefined)}`)
      .expect(404);
    expect(fake.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id, sourceApplication: "homixliving", deletedAt: null, portalOwnerAgentId: 42 },
      })
    );
  });
  it.each(["preview", "test", "publish", "pause", "resume", "cancel", "nearby", "ai", "ai-apply"])(
    "checks ownership before %s",
    async (action) => {
      const path = `/campaigns/${id}/${action}`,
        body = {};
      await request(app)
        .post(prefix + path)
        .set("Authorization", `Bearer ${token("POST", path, body)}`)
        .send(body)
        .expect(404);
      expect(fake.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id, sourceApplication: "homixliving", deletedAt: null, portalOwnerAgentId: 42 },
        })
      );
      expect(fake.preview).not.toHaveBeenCalled();
      expect(fake.testSend).not.toHaveBeenCalled();
      expect(fake.publish).not.toHaveBeenCalled();
      expect(fake.transition).not.toHaveBeenCalled();
    }
  );
  it("limits an administrator's list to Portal campaigns", async () => {
    const path = "/campaigns";
    await request(app)
      .get(prefix + path)
      .set("Authorization", `Bearer ${token("GET", path, undefined, true)}`)
      .expect(200);
    expect(fake.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sourceApplication: "homixliving", deletedAt: null } })
    );
  });
  it("provisions an isolated Portal principal even when a native account has the same email", async () => {
    fake.userFind.mockImplementation(async ({ where }) =>
      where.portalAgentId ? null : { id: "legacy-admin", role: "ADMIN" }
    );
    fake.userCreate.mockImplementation(async ({ data }) => ({ id: "portal-user", ...data }));
    const path = "/campaigns";
    await request(app)
      .get(prefix + path)
      .set("Authorization", `Bearer ${token("GET", path, undefined)}`)
      .expect(200);
    expect(fake.userCreate).toHaveBeenCalledWith({
      data: {
        portalAgentId: 42,
        email: brand.email,
        emailNormalized: "portal-agent:42",
        displayName: brand.name,
        role: "MARKETER",
      },
    });
    expect(fake.userFind).toHaveBeenCalledTimes(1);
    expect(fake.userUpdate).not.toHaveBeenCalled();
  });
  it("rejects disabled mapped users before accessing campaigns", async () => {
    fake.userFind.mockResolvedValue({ id: "mapped-user", isActive: false });
    const path = "/campaigns";
    await request(app)
      .get(prefix + path)
      .set("Authorization", `Bearer ${token("GET", path, undefined)}`)
      .expect(403);
    expect(fake.findMany).not.toHaveBeenCalled();
  });
  it("deletes only the owned, unchanged draft and keeps an audit record", async () => {
    fake.deleteDraft.mockResolvedValue({ count: 1 });
    const path = `/campaigns/${id}`,
      body = { version: 3 };
    await request(app)
      .delete(prefix + path)
      .set("Authorization", `Bearer ${token("DELETE", path, body)}`)
      .send(body)
      .expect(200);
    expect(fake.deleteDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id,
          sourceApplication: "homixliving",
          deletedAt: null,
          portalOwnerAgentId: 42,
          status: "DRAFT",
          version: 3,
        },
      })
    );
    expect(fake.audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ action: "campaign.delete_draft", entityId: id })
    );
  });
  it("rejects foreign, published, deleted or changed drafts without an audit mutation", async () => {
    fake.deleteDraft.mockResolvedValue({ count: 0 });
    const path = `/campaigns/${id}`,
      body = { version: 3 };
    await request(app)
      .delete(prefix + path)
      .set("Authorization", `Bearer ${token("DELETE", path, body)}`)
      .send(body)
      .expect(409);
    expect(fake.audit).not.toHaveBeenCalled();
  });
  it("rejects unsigned deletion", async () => {
    await request(app)
      .delete(prefix + `/campaigns/${id}`)
      .send({ version: 3 })
      .expect(401);
    expect(fake.deleteDraft).not.toHaveBeenCalled();
  });
});
