import { PrismaClient } from "@prisma/client";

const globalPrisma = globalThis as unknown as { homixPrisma?: PrismaClient };

export const prisma =
  globalPrisma.homixPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalPrisma.homixPrisma = prisma;

export async function closePrisma(): Promise<void> {
  await prisma.$disconnect();
}

export async function checkDatabase(): Promise<void> {
  const applied = await prisma.$queryRaw<Array<{ migration_name: string }>>`
    SELECT migration_name
    FROM _prisma_migrations
    WHERE migration_name = '20260821190229_initial'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
    LIMIT 1
  `;
  if (!applied[0]) throw new Error("Required database migration is not applied");
}
