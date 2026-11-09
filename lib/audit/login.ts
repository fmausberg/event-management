import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

export type LoginMethod = "password" | "google" | "github" | "recovery";
const methods: Record<LoginMethod, string> = {
  password: "Passwort", google: "Google", github: "GitHub", recovery: "Recovery-Admin",
};

// Internal append-only writer. Accept only verified identity and a known method,
// never credentials, account payloads, cookies or tokens.
export async function appendLoginAudit(base: PrismaClient, userId: string, method: LoginMethod) {
  if (!userId || !Object.hasOwn(methods, method)) throw new Error("Invalid login audit identity or method");
  await base.auditLog.create({ data: {
    model: "Login", recordId: randomUUID(), recordName: `Anmeldung (${methods[method]})`,
    companyId: null, action: "CREATE", operation: "Login.create",
    actorType: "USER", actorUserId: userId, source: "auth.signIn", correlationId: randomUUID(),
    changedFields: ["userId", "method"], redactedFields: [],
    before: Prisma.DbNull, after: { userId, method }, policyVersion: 5,
  } });
}
