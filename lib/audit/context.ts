import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export type AuditContext = {
  actorType: "USER" | "SYSTEM" | "ANONYMOUS" | "UNKNOWN";
  actorUserId?: string;
  source: string;
  correlationId: string;
};
// Share the store across development hot reloads and server module bundles.
const globalForAudit = globalThis as unknown as { eventSeriesAuditContext?: AsyncLocalStorage<AuditContext> };
const context = globalForAudit.eventSeriesAuditContext ??= new AsyncLocalStorage<AuditContext>();

// Call only with server-verified identity / authenticated job provenance.
export function withAuditContext<T>(value: Omit<AuditContext, "correlationId">, work: () => T): T {
  if (value.actorType === "USER" && !value.actorUserId) throw new Error("Audit: USER requires a verified user ID.");
  return context.run({ ...value, actorUserId: value.actorType === "USER" ? value.actorUserId : undefined, correlationId: randomUUID() }, work);
}

export function currentAuditContext(fallback?: AuditContext): AuditContext {
  return context.getStore() ?? fallback ?? { actorType: "UNKNOWN", source: "unscoped-prisma", correlationId: randomUUID() };
}
