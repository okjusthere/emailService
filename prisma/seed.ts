import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { seedDatabase } from "./seedData.js";

const prisma = new PrismaClient();

seedDatabase(prisma)
  .finally(async () => prisma.$disconnect())
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
