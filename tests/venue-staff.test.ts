import { beforeEach, expect, it, vi } from "vitest";
import { addVenueStaff, listVenueStaff, removeVenueStaff } from "@/app/company/[companyKey]/venues/staff-actions";
const { access, db } = vi.hoisted(() => ({ access: vi.fn(), db: { venue: { findFirst: vi.fn() }, venueStaff: { create: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() }, user: { findMany: vi.fn() } } }));
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "actor" } }) }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("@/lib/companies/members", async (original) => ({ ...await original<typeof import("@/lib/companies/members")>(), requireCompanyAccess: access }));
beforeEach(() => { vi.resetAllMocks(); access.mockResolvedValue({ company: { id: "company" } }); db.venue.findFirst.mockResolvedValue({ id: "venue" }); db.user.findMany.mockResolvedValue([]); });
it("normalizes email and supports staff without an account", async () => {
 expect(await addVenueStaff("slug", "venue", " ADA@example.com ")).toEqual({ success: true });
 expect(db.venueStaff.create).toHaveBeenCalledWith({ data: { venueId: "venue", email: "ada@example.com", userId: null, assignedById: "actor" } });
});
it("links existing users", async () => {
 db.user.findMany.mockResolvedValue([{ id: "user" }]);
 await addVenueStaff("slug", "venue", "ada@example.com");
 expect(db.venueStaff.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: "user" }) });
});
it("rejects foreign venues for all operations", async () => {
 db.venue.findFirst.mockResolvedValue(null);
 await addVenueStaff("slug", "foreign", "ada@example.com"); await listVenueStaff("slug", "foreign"); await removeVenueStaff("slug", "foreign", "staff");
 expect(db.venueStaff.create).not.toHaveBeenCalled(); expect(db.venueStaff.findMany).not.toHaveBeenCalled(); expect(db.venueStaff.deleteMany).not.toHaveBeenCalled();
 expect(db.venue.findFirst).toHaveBeenCalledWith({ where: { id: "foreign", companyId: "company" }, select: { id: true } });
});
it("checks access and scopes removal", async () => {
 await removeVenueStaff("slug", "venue", "staff");
 expect(db.venueStaff.deleteMany).toHaveBeenCalledWith({ where: { id: "staff", venueId: "venue" } });
 access.mockRejectedValue(new Error("denied"));
 expect((await addVenueStaff("slug", "venue", "ada@example.com")).success).toBeUndefined();
 expect(db.venueStaff.create).not.toHaveBeenCalled();
});
it("shows sorted statuses including accounts created after assignment", async () => {
 db.venueStaff.findMany.mockResolvedValue([{ id: "z", email: "z@example.com", user: null }, { id: "b", email: "b@example.com", user: null }, { id: "a", email: "a@example.com", user: { email: "a@example.com", emailVerified: new Date() } }]);
 db.user.findMany.mockResolvedValue([{ email: "b@example.com", emailVerified: null }]);
 expect((await listVenueStaff("slug", "venue")).staff).toEqual([{ id: "a", email: "a@example.com", status: "verified" }, { id: "b", email: "b@example.com", status: "not verified" }, { id: "z", email: "z@example.com", status: "no account" }]);
});
it("validates email before writing", async () => {
 await addVenueStaff("slug", "venue", "bad");
 expect(db.venueStaff.create).not.toHaveBeenCalled();
});
