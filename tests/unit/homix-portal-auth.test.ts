import { createHash, createHmac, randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { verifyPortalToken, campaignPortalIdentity } from "../../src/modules/auth/portal.js";
const secret = "test-portal-secret-at-least-thirty-two-characters";
const brand = {
  agentId: 42,
  name: "Portal Agent",
  email: "agent@example.com",
  phone: "2125550100",
  title: "Agent",
  licenseNumber: "TEST",
  companyId: "homix_realty",
  companyName: "Homix Realty",
  photoUrl: null,
};
const now = 1_800_000_000;
const request = {
  method: "POST",
  path: "/api/integrations/homix/v1/campaigns",
  body: JSON.stringify({ sourceKey: "123" }),
};
const claims = {
  iss: "homixliving",
  aud: "email-service",
  sub: "42",
  iat: now,
  exp: now + 90,
  jti: randomUUID(),
  admin: false,
  email: brand.email,
  brand,
  method: request.method,
  path: request.path,
  bodyHash: createHash("sha256").update(request.body).digest("hex"),
};
function sign(value: unknown, key = secret) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    body = Buffer.from(JSON.stringify(value)).toString("base64url"),
    data = `${header}.${body}`;
  return `${data}.${createHmac("sha256", key).update(data).digest("base64url")}`;
}
describe("Portal service authentication", () => {
  it("accepts a valid request-bound short-lived signature", () =>
    expect(verifyPortalToken(sign(claims), secret, request, now)).toMatchObject({
      sub: "42",
      admin: false,
    }));
  it.each([
    { ...request, method: "GET" },
    { ...request, path: request.path + "/other" },
    { ...request, body: "{}" },
  ])("rejects method, resource and payload substitution", (r) =>
    expect(() => verifyPortalToken(sign(claims), secret, r, now)).toThrow()
  );
  it.each([
    { ...claims, exp: now },
    { ...claims, exp: now + 3600 },
    { ...claims, iat: now + 20 },
    { ...claims, aud: "other-service" },
    { ...claims, sub: "99" },
    { ...claims, email: "other@example.com" },
  ])("rejects expired, overlong or mismatched identity claims", (c) =>
    expect(() => verifyPortalToken(sign(c), secret, request, now)).toThrow()
  );
  it("rejects unsigned and wrong-key tokens", () => {
    expect(() => verifyPortalToken("header.body", secret, request, now)).toThrow();
    expect(() => verifyPortalToken(sign(claims, "another-key"), secret, request, now)).toThrow();
  });
});
describe("Campaign marketing identity", () => {
  const marketingIdentity = {
    ...brand,
    companyAddress: "123 Test Street",
    companyWebsite: "https://example.com",
  };
  it("uses a valid Portal campaign identity without changing the shared listing", () =>
    expect(
      campaignPortalIdentity({
        sourceApplication: "homixliving",
        portalOwnerAgentId: 42,
        marketingIdentity,
      })
    ).toEqual(marketingIdentity));
  it("leaves legacy campaign identity resolution unchanged", () =>
    expect(campaignPortalIdentity({ sourceApplication: null, marketingIdentity })).toBeNull());
  it("fails closed on missing or cross-agent marketing identity", () => {
    expect(() =>
      campaignPortalIdentity({
        sourceApplication: "homixliving",
        portalOwnerAgentId: 43,
        marketingIdentity,
      })
    ).toThrow();
    expect(() =>
      campaignPortalIdentity({
        sourceApplication: "homixliving",
        portalOwnerAgentId: 42,
        marketingIdentity: null,
      })
    ).toThrow();
  });
});
