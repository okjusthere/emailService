import type { UserRole } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      id?: string;
      user?: { id: string; email: string; displayName: string | null; role: UserRole };
      rawBody?: string;
    }
  }
}

export {};
