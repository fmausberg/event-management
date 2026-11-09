import { beforeEach, expect, it, vi } from "vitest";
import { changeUserRole } from "@/app/admin/users/actions";
import { getUsersForAdmin } from "@/lib/users/admin-data";

const { db, auth } = vi.hoisted(() => ({
  db: { user: { count: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() } },
  auth: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
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

function roleForm(role = "ADMIN") {
  const data = new FormData();
  data.set("role", role);
  return data;
}

it.each(["USER", "COMPANY_ADMIN", "COMPANY_USER"])("denies role changes by %s", async (role) => {
  db.user.findUnique.mockResolvedValue({ id: "actor", role });
  expect(await changeUserRole("target", {}, roleForm())).not.toHaveProperty("success");
  expect(db.user.updateMany).not.toHaveBeenCalled();
});

it("denies unauthenticated role changes", async () => {
  auth.mockResolvedValue(null);
  expect(await changeUserRole("target", {}, roleForm())).not.toHaveProperty("success");
  expect(db.user.updateMany).not.toHaveBeenCalled();
});

it.each(["ADMIN", "USER"])("allows platform admins to assign %s", async (role) => {
  db.user.updateMany.mockResolvedValue({ count: 1 });
  expect(await changeUserRole("target", {}, roleForm(role))).toMatchObject({ success: true });
  expect(db.user.updateMany).toHaveBeenCalledWith({ where: { id: "target" }, data: { role } });
});

it.each([["", "ADMIN"], ["target", "COMPANY_ADMIN"], ["target", "invalid"]])("rejects invalid user or role: %s %s", async (id, role) => {
  expect(await changeUserRole(id, {}, roleForm(role))).not.toHaveProperty("success");
  expect(db.user.updateMany).not.toHaveBeenCalled();
});

it("reports users that no longer exist", async () => {
  db.user.updateMany.mockResolvedValue({ count: 0 });
  expect(await changeUserRole("missing", {}, roleForm())).toMatchObject({ message: "Dieser User existiert nicht mehr." });
});

it("reports persistence errors", async () => {
  db.user.updateMany.mockRejectedValue(new Error("database unavailable"));
  expect(await changeUserRole("target", {}, roleForm())).toMatchObject({ message: expect.stringContaining("nicht gespeichert") });
});

it("lets the recovery identity promote a user only while no platform admin exists", async () => {
  auth.mockResolvedValue({ user: { id: "__recovery_admin__" } });
  db.user.count.mockResolvedValue(0);
  db.user.updateMany.mockResolvedValue({ count: 1 });
  expect(await changeUserRole("target", {}, roleForm())).toMatchObject({ success: true });
  db.user.updateMany.mockClear();
  db.user.count.mockResolvedValue(1);
  expect(await changeUserRole("target", {}, roleForm())).not.toHaveProperty("success");
  expect(db.user.updateMany).not.toHaveBeenCalled();
});
