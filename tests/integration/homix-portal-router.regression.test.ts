import { createHash, createHmac, randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { prisma } from "../../src/db/prisma.js";
import { homixRouter } from "../../src/web/routes/homix.js";
import { errorHandler } from "../../src/shared/errors.js";
const id = 2000000 + Math.floor(Math.random() * 1000000);
const email = `portal-db-${randomUUID()}@example.com`;
const secret = "postgres-router-regression-secret-over-32-characters";
const prefix = "/api/integrations/homix/v1";
const brand = {
  agentId: id,
  name: "Integration Agent",
  email,
  phone: "",
  title: "",
  licenseNumber: "",
  companyId: "homix_realty",
  companyName: "Homix Realty Inc.",
  photoUrl: null,
};
process.env.HOMIX_PORTAL_INTEGRATION_SECRET = secret;
process.env.HOMIX_PORTAL_COMPANIES_JSON = JSON.stringify({
  homix_realty: {
    senderProfileId: randomUUID(),
    companyName: "Homix Realty Inc.",
    companyAddress: "Test office",
    companyWebsite: "https://homixny.com",
  },
});
const app = express();
app.use(express.json());
app.use(prefix, homixRouter);
app.use(errorHandler);
function token(path: string) {
  const now = Math.floor(Date.now() / 1000);
  const head = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const data = Buffer.from(
    JSON.stringify({
      iss: "homixliving",
      aud: "email-service",
      sub: String(id),
      iat: now,
      exp: now + 90,
      jti: randomUUID(),
      admin: false,
      email,
      brand,
      method: "GET",
      path: prefix + path,
      bodyHash: createHash("sha256").update("").digest("hex"),
    })
  ).toString("base64url");
  return `${head}.${data}.${createHmac("sha256", secret).update(`${head}.${data}`).digest("base64url")}`;
}
afterAll(async () => {
  await prisma.user.deleteMany({ where: { portalAgentId: id, emailNormalized: email } });
  await prisma.$disconnect();
});
it("provisions one stable Portal user under concurrent real PostgreSQL requests", async () => {
  const responses = await Promise.all(
    ["/status", "/campaigns", "/status"].map((path) =>
      request(app)
        .get(prefix + path)
        .set("Authorization", `Bearer ${token(path)}`)
    )
  );
  expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
  expect(await prisma.user.count({ where: { portalAgentId: id, emailNormalized: email } })).toBe(1);
  expect(responses[0].body.brand.companyName).toBe("Homix Realty Inc.");
});
it("rejects a disabled mapped account against real PostgreSQL", async () => {
  await prisma.user.update({ where: { portalAgentId: id }, data: { isActive: false } });
  const r = await request(app)
    .get(prefix + "/status")
    .set("Authorization", `Bearer ${token("/status")}`);
  expect(r.status).toBe(403);
  expect(r.body.error.code).toBe("USER_DISABLED");
});
