import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};
let prisma: PrismaClient | undefined;

// Lazy creation keeps builds and module imports independent of a running DB.
export function getPrisma(): PrismaClient {
  const existing = prisma ?? globalForPrisma.prisma;
  if (existing) return existing;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString?.trim()) {
    throw new Error("DATABASE_URL is required for database access.");
  }

  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
  return prisma;
}
