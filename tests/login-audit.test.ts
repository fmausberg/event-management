import { beforeEach, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { appendLoginAudit } from "@/lib/audit/login";
import { createAuditedClient } from "@/lib/audit/client";
import { parseAuditFilters } from "@/lib/audit/filters";
import { AuditTable } from "@/components/audit-table";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));
const create = vi.fn();
const base = { auditLog: { create, deleteMany: vi.fn() } } as unknown as PrismaClient;
beforeEach(() => create.mockReset());

it.each(["password", "google", "github", "recovery"] as const)("records a platform login via %s without credentials or session secrets", async (method) => {
  await appendLoginAudit(base, "user-1", method);
  const data = create.mock.calls[0][0].data;
  expect(data).toMatchObject({ model: "Login", action: "CREATE", companyId: null, actorType: "USER", actorUserId: "user-1", source: "auth.signIn", before: Prisma.DbNull, after: { userId: "user-1", method } });
  expect(Object.keys(data.after).sort()).toEqual(["method", "userId"]);
  expect(data.changedFields).toEqual(["userId", "method"]);
});

it("assigns separate event identities to repeated logins", async () => {
  await appendLoginAudit(base, "user-1", "password");
  await appendLoginAudit(base, "user-1", "password");
  expect(create.mock.calls[0][0].data.recordId).not.toBe(create.mock.calls[1][0].data.recordId);
});

it("keeps arbitrary AuditLog writes blocked on the application facade", async () => {
  const db = createAuditedClient(base);
  await expect(db.auditLog.create({ data: {} } as never)).rejects.toThrow("schreibgeschützt");
  await expect(db.auditLog.deleteMany()).rejects.toThrow("schreibgeschützt");
  expect(create).not.toHaveBeenCalled();
});

it("exposes Login as a filter and renders only approved login attributes", () => {
  expect(parseAuditFilters({ model: "Login", action: "CREATE" }).models).toEqual(["Login"]);
  const markup = renderToStaticMarkup(createElement(AuditTable, { showTarget: true, entries: [{
    id: "audit-1", model: "Login", recordId: "login-1", recordName: "Anmeldung (Google)", occurredAt: new Date("2026-11-09T10:00:00Z"),
    actorType: "USER", actorUserId: "user-1", actorEmail: "ada@example.com", action: "CREATE", changedFields: ["userId", "method", "token"], redactedFields: [],
    before: null, after: { userId: "user-1", method: "google", token: "must-not-render" },
  }] }));
  expect(markup).toContain("Anmeldung (Google)");
  expect(markup).toContain("Anmeldeart");
  expect(markup).toContain("google");
  expect(markup).not.toContain("must-not-render");
});
