vi.mock("@/lib/mail/assignment", () => ({ notifyAssignment: vi.fn(async () => ({ success: true })) }));
import { beforeEach, expect, it, vi } from "vitest";
import { addEventStaff, listEventStaff, removeEventStaff } from "@/app/company/[companyKey]/events/staff-actions";
const { access, db } = vi.hoisted(() => ({ access: vi.fn(), db: { event: { findFirst: vi.fn() }, eventStaff: { create: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() }, user: { findMany: vi.fn() } } }));
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "actor" } }) }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("@/lib/companies/members", async (original) => ({ ...await original<typeof import("@/lib/companies/members")>(), requireCompanyAccess: access }));
beforeEach(() => { vi.resetAllMocks(); db.eventStaff.create.mockResolvedValue({ id: "assignment" }); access.mockResolvedValue({ company: { id: "company" } }); db.event.findFirst.mockResolvedValue({ id: "event" }); db.user.findMany.mockResolvedValue([]); });
it("normalizes email and supports staff without an account", async () => {
 expect(await addEventStaff("slug", "event", " ADA@example.com ")).toMatchObject({ success: true });
 expect(db.eventStaff.create).toHaveBeenCalledWith({ data: { eventId: "event", email: "ada@example.com", userId: null, assignedById: "actor" } });
});
it("links existing users", async () => {
 db.user.findMany.mockResolvedValue([{ id: "user", emailVerified: new Date() }]);
 await addEventStaff("slug", "event", "ada@example.com");
 expect(db.eventStaff.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: "user" }) });
});
it("rejects foreign events for all operations", async () => {
 db.event.findFirst.mockResolvedValue(null);
 await addEventStaff("slug", "foreign", "ada@example.com"); await listEventStaff("slug", "foreign"); await removeEventStaff("slug", "foreign", "staff");
 expect(db.eventStaff.create).not.toHaveBeenCalled(); expect(db.eventStaff.findMany).not.toHaveBeenCalled(); expect(db.eventStaff.deleteMany).not.toHaveBeenCalled();
 expect(db.event.findFirst).toHaveBeenCalledWith({ where: { id: "foreign", companyId: "company" }, select: { id: true } });
});
it("checks access and scopes removal", async () => {
 await removeEventStaff("slug", "event", "staff");
 expect(db.eventStaff.deleteMany).toHaveBeenCalledWith({ where: { id: "staff", eventId: "event" } });
 access.mockRejectedValue(new Error("denied"));
 expect((await addEventStaff("slug", "event", "ada@example.com")).success).toBeUndefined();
 expect(db.eventStaff.create).not.toHaveBeenCalled();
});
it("shows sorted statuses including accounts created after assignment", async () => {
 db.eventStaff.findMany.mockResolvedValue([{ id: "z", email: "z@example.com", user: null }, { id: "b", email: "b@example.com", user: null }, { id: "a", email: "a@example.com", user: { email: "a@example.com", emailVerified: new Date() } }]);
 db.user.findMany.mockResolvedValue([{ email: "b@example.com", emailVerified: null }]);
 expect((await listEventStaff("slug", "event")).staff).toEqual([{ id: "a", email: "a@example.com", status: "verified" }, { id: "b", email: "b@example.com", status: "not verified" }, { id: "z", email: "z@example.com", status: "no account" }]);
});
it("validates email before writing", async () => {
 await addEventStaff("slug", "event", "bad");
 expect(db.eventStaff.create).not.toHaveBeenCalled();
});

it("keeps existing unverified accounts unlinked", async () => {
 db.user.findMany.mockResolvedValue([{ id: "user", emailVerified: null }]);
 await addEventStaff("slug", "scope", "ada@example.com");
 expect(db.eventStaff.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: null }) });
});
