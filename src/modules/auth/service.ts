import { UserRole } from "@prisma/client";
import { config } from "../../config/index.js";
import { prisma } from "../../db/prisma.js";
import { inTransaction } from "../../db/transactions.js";
import { DomainError } from "../../shared/errors.js";
import { normalizeEmail } from "../../shared/normalize.js";
import type { EasyAuthIdentity } from "./EasyAuthPrincipalParser.js";

export async function resolveLocalUser(emailInput: string) {
  if (config.authMode !== "local" || config.nodeEnv === "production")
    throw new DomainError("LOCAL_AUTH_DISABLED", "Local authentication is disabled.", 404);
  const email = normalizeEmail(emailInput);
  if (email !== config.localAdminEmail)
    throw new DomainError("ACCESS_DENIED", "This local account is not configured.", 403);
  return prisma.user.upsert({
    where: { emailNormalized: email },
    create: {
      email,
      emailNormalized: email,
      displayName: "Local Admin",
      role: UserRole.ADMIN,
      lastLoginAt: new Date(),
    },
    update: { lastLoginAt: new Date(), isActive: true },
  });
}

export async function resolveAzureUser(identity: EasyAuthIdentity) {
  const email = normalizeEmail(identity.email);
  return inTransaction(async (tx) => {
    const byObjectId = await tx.user.findUnique({ where: { entraObjectId: identity.objectId } });
    if (byObjectId) {
      if (!byObjectId.isActive)
        throw new DomainError("USER_DISABLED", "This account is disabled.", 403);
      const emailOwner = await tx.user.findUnique({ where: { emailNormalized: email } });
      if (emailOwner && emailOwner.id !== byObjectId.id)
        throw new DomainError(
          "IDENTITY_EMAIL_CONFLICT",
          "This identity cannot be linked automatically. Ask an administrator for help.",
          403
        );
      return tx.user.update({
        where: { id: byObjectId.id },
        data: {
          email,
          emailNormalized: email,
          displayName: identity.displayName,
          lastLoginAt: new Date(),
        },
      });
    }

    const byEmail = await tx.user.findUnique({ where: { emailNormalized: email } });
    if (byEmail) {
      if (!byEmail.isActive)
        throw new DomainError("USER_DISABLED", "This account is disabled.", 403);
      if (byEmail.entraObjectId)
        throw new DomainError(
          "IDENTITY_MISMATCH",
          "This identity does not match the account provisioned for this email.",
          403
        );
      const claimed = await tx.user.updateMany({
        where: { id: byEmail.id, entraObjectId: null },
        data: {
          entraObjectId: identity.objectId,
          email,
          displayName: identity.displayName,
          lastLoginAt: new Date(),
        },
      });
      if (claimed.count !== 1)
        throw new DomainError(
          "IDENTITY_MISMATCH",
          "This identity could not be linked safely. Ask an administrator for help.",
          403
        );
      return tx.user.findUniqueOrThrow({ where: { id: byEmail.id } });
    }

    const domain = email.split("@")[1] ?? "";
    const isBootstrap = config.bootstrapAdminEmails.includes(email);
    if (
      !isBootstrap &&
      (!config.autoProvisionUsers || !config.allowedEmailDomains.includes(domain))
    ) {
      throw new DomainError(
        "USER_NOT_PROVISIONED",
        "Ask an administrator to provision your Homix Marketing account.",
        403
      );
    }
    return tx.user.create({
      data: {
        entraObjectId: identity.objectId,
        email,
        emailNormalized: email,
        displayName: identity.displayName,
        role: isBootstrap ? UserRole.ADMIN : UserRole.VIEWER,
        lastLoginAt: new Date(),
      },
    });
  });
}
