import { beforeEach, expect, it, vi } from "vitest";
import { getUsersForAdmin } from "@/lib/users/admin-data";

const { db, auth } = vi.hoisted(() => ({
  db: { user: { findUnique: vi.fn(), findMany: vi.fn() } },
  auth: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));

beforeEach(() => {
  vi.resetAllMocks();
  auth.mockResolvedValue({ user: { id: "admin" } });
  db.user.findUnique.mockResolvedValue({ id: "admin", role: "ADMIN" });
});

it.each(["USER", "COMPANY_ADMIN", "COMPANY_USER"])("denies %s access before reading users", async (role) => {
  db.user.findUnique.mockResolvedValue({ role });
  await expect(getUsersForAdmin()).rejects.toMatchObject({ reason: "FORBIDDEN" });
  expect(db.user.findMany).not.toHaveBeenCalled();
});

it("denies unauthenticated access before reading users", async () => {
  auth.mockResolvedValue(null);
  await expect(getUsersForAdmin()).rejects.toMatchObject({ reason: "UNAUTHENTICATED" });
  expect(db.user.findMany).not.toHaveBeenCalled();
});

it("includes users without bookings and totals issued and checked-in tickets across bookings", async () => {
  db.user.findMany.mockResolvedValue([
    { id: "a", number: 1, name: "Anna", email: "anna@example.com", memberships: [{ company: { name: "Studio" } }], bookings: [
      { _count: { tickets: 3 }, tickets: [{ id: "t1" }] },
      { _count: { tickets: 2 }, tickets: [{ id: "t2" }, { id: "t3" }] },
    ] },
    { id: "b", number: 2, name: null, email: "b@example.com", memberships: [], bookings: [] },
  ]);
  const users = await getUsersForAdmin();
  expect(users[0]).toMatchObject({ purchasedTickets: 5, redeemedTickets: 3, companies: ["Studio"] });
  expect(users[1]).toMatchObject({ purchasedTickets: 0, redeemedTickets: 0, companies: [] });
  expect(db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
    orderBy: { number: "asc" },
    select: expect.objectContaining({ memberships: expect.objectContaining({ where: { status: "ACTIVE" } }) }),
  }));
});
