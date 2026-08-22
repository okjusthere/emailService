import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "./prisma.js";

export type TransactionClient = Prisma.TransactionClient;

export async function inTransaction<T>(
  callback: (tx: TransactionClient) => Promise<T>,
  client: PrismaClient = prisma
): Promise<T> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await client.$transaction(callback, {
        isolationLevel: "Serializable",
        maxWait: 5000,
        timeout: 15000,
      });
    } catch (error) {
      const isWriteConflict =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2034" ||
          (error.code === "P2010" && String(error.meta?.code ?? "") === "40001"));
      if (!isWriteConflict || attempt === maxAttempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 10));
    }
  }
  throw new Error("Serializable transaction retry loop exhausted unexpectedly");
}
