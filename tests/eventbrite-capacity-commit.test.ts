import { beforeEach, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createAuditedClient } from "@/lib/audit/client";
const { deliver } = vi.hoisted(() => ({ deliver: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/eventbrite/capacity", () => ({ deliverPendingEventbriteCapacity: deliver }));
vi.mock("@/lib/companies/event-publication", () => ({ queueEventPublication: vi.fn() }));
vi.mock("@/lib/audit/policy", () => ({ auditPolicies: {} }));

let active: boolean;
beforeEach(() => { vi.resetAllMocks(); active = false; deliver.mockImplementation(async () => { expect(active).toBe(false); }); });
function client() {
  const base = { booking: { create: vi.fn(async () => ({ id: "booking" })), update: vi.fn(async () => ({ id: "booking" })) },
    $transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => { active = true; try { return await work(base); } finally { active = false; } }),
  };
  return createAuditedClient(base as unknown as PrismaClient);
}
it("drains only after commit and coalesces multiple booking mutations", async () => {
  const db = client();
  await db.$transaction(async tx => {
    await tx.booking.create({ data: { eventId: "event", quantity: 2, status: "PENDING_PAYMENT" } });
    await tx.booking.update({ where: { id: "booking" }, data: { status: "CONFIRMED" } });
    expect(deliver).not.toHaveBeenCalled();
  });
  expect(deliver).toHaveBeenCalledTimes(1);
});
it("does not contact Eventbrite for rolled back bookings", async () => {
  await expect(client().$transaction(async tx => {
    await tx.booking.create({ data: { eventId: "event", quantity: 2 } });
    throw new Error("rollback");
  })).rejects.toThrow("rollback");
  expect(deliver).not.toHaveBeenCalled();
});
it("does not report a failed booking when the post-commit provider call fails", async () => {
  deliver.mockRejectedValue(new Error("provider unavailable"));
  expect(await client().booking.create({ data: { eventId: "event", quantity: 2 } })).toEqual({ id: "booking" });
});
it("does not trigger stock updates for unrelated account-linking writes", async () => {
  await client().booking.update({ where: { id: "booking" }, data: { userId: "user" } });
  expect(deliver).not.toHaveBeenCalled();
});
