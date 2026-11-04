import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { createAuditedClient } from "@/lib/audit/client";

const globalForPrisma = globalThis as unknown as {
  auditBasePrisma?: PrismaClient;
};
let prisma: PrismaClient | undefined;

// Lazy creation keeps builds and module imports independent of a running DB.
export function getPrisma(): PrismaClient {
  if (prisma) return prisma;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString?.trim()) {
    throw new Error("DATABASE_URL is required for database access.");
  }

  const base = globalForPrisma.auditBasePrisma ?? new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  if (process.env.NODE_ENV !== "production") globalForPrisma.auditBasePrisma = base;
  // Cache the connection pool, not a facade with stale policy/context closures.
  prisma = createAuditedClient(base);
  return prisma;
}
