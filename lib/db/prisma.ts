import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { createAuditedClient } from "@/lib/audit/client";
import { appendLoginAudit, type LoginMethod } from "@/lib/audit/login";

const globalForPrisma = globalThis as unknown as {
  auditBasePrisma?: PrismaClient;
};
let prisma: PrismaClient | undefined;
let basePrisma: PrismaClient | undefined;

// Lazy creation keeps builds and module imports independent of a running DB.
function getBasePrisma(): PrismaClient {
  if (basePrisma) return basePrisma;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString?.trim()) {
    throw new Error("DATABASE_URL is required for database access.");
  }

  const base = globalForPrisma.auditBasePrisma ?? new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  if (process.env.NODE_ENV !== "production") globalForPrisma.auditBasePrisma = base;
  basePrisma = base;
  return base;
}

export function getPrisma(): PrismaClient {
  if (prisma) return prisma;
  // Cache the connection pool, not a facade with stale policy/context closures.
  prisma = createAuditedClient(getBasePrisma());
  return prisma;
}

// Dedicated event writer; general AuditLog writes remain blocked by the facade.
export async function recordLoginAudit(userId: string, method: LoginMethod) {
  await appendLoginAudit(getBasePrisma(), userId, method);
}
