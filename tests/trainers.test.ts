vi.mock("@/lib/mail/assignment", () => ({ notifyAssignment: vi.fn(async () => ({ success: true })) }));
import { beforeEach, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { renderToStaticMarkup } from "react-dom/server";
import { saveTrainer, deleteTrainer } from "@/app/company/[companyKey]/trainers/actions";
import Page from "@/app/company/[companyKey]/trainers/page";
import AdminPage from "@/app/admin/trainers/page";
import { getCompanyTrainers, getTrainerCompanies } from "@/lib/trainers/data";
import { trainerSchema } from "@/lib/trainers/validation";

const { auth, db } = vi.hoisted(() => ({ auth: vi.fn(), db: {
  eventReview: { groupBy: vi.fn() },
  user: { findMany: vi.fn(), findUnique: vi.fn() }, company: { findUnique: vi.fn(), findMany: vi.fn() }, companyMembership: { findUnique: vi.fn() },
  trainer: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
} }));
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("LOGIN"); }, notFound: () => { throw new Error("NOT_FOUND"); } }));
const values = { firstName: " Ada ", lastName: " Lovelace ", email: " ADA@example.com " };
function form(overrides: Record<string, string> = {}) {
  const data = new FormData(); Object.entries({ ...values, ...overrides }).forEach(([key, value]) => data.set(key, value)); return data;
}
const company = { id: "company-1", slug: "yoga", name: "Yoga" };
beforeEach(() => {
  vi.resetAllMocks(); db.user.findMany.mockResolvedValue([]); auth.mockResolvedValue({ user: { id: "actor" } });
  db.eventReview.groupBy.mockResolvedValue([]);
  db.user.findUnique.mockResolvedValue({ role: "USER" });
  db.company.findUnique.mockResolvedValue(company); db.company.findMany.mockResolvedValue([company]);
  db.companyMembership.findUnique.mockResolvedValue({ role: "COMPANY_USER", status: "ACTIVE" });
  db.trainer.findMany.mockResolvedValue([]);
  db.trainer.updateMany.mockResolvedValue({ count: 1 }); db.trainer.deleteMany.mockResolvedValue({ count: 1 });
});
it.each(["COMPANY_USER", "COMPANY_ADMIN"])("allows active %s to create a trainer without a user account", async (role) => {
  db.companyMembership.findUnique.mockResolvedValue({ role, status: "ACTIVE" });
  expect((await saveTrainer("yoga", null, {}, form({ companyId: "foreign", userId: "foreign", number: "123" }))).success).toBe(true);
  expect(db.trainer.create).toHaveBeenCalledWith({ data: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", userId: null, companyId: "company-1" }, select: { id: true, firstName: true, lastName: true, email: true } });
});
it("lets global admins manage a company without membership", async () => {
  db.user.findUnique.mockResolvedValue({ role: "ADMIN" }); db.companyMembership.findUnique.mockResolvedValue(null);
  expect((await saveTrainer("yoga", null, {}, form())).success).toBe(true);
});
it("returns the created trainer for immediate selection in event forms", async () => {
 const trainer = { id: "trainer-1", firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" };
 db.trainer.create.mockResolvedValue(trainer);
 expect((await saveTrainer("yoga", null, {}, form())).trainer).toEqual(trainer);
});
it.each([null, { role: "COMPANY_USER", status: "INVITED" }, { role: "COMPANY_ADMIN", status: "SUSPENDED" }])("denies inactive or foreign membership %j", async (membership) => {
  db.companyMembership.findUnique.mockResolvedValue(membership);
  await expect(getCompanyTrainers("yoga")).rejects.toThrow();
  expect((await saveTrainer("yoga", null, {}, form())).success).toBeUndefined();
  expect((await deleteTrainer("yoga", "trainer-1", {}, form({ confirmed: "yes" }))).success).toBeUndefined();
  expect(db.trainer.create).not.toHaveBeenCalled(); expect(db.trainer.deleteMany).not.toHaveBeenCalled();
  await expect(Page({ params: Promise.resolve({ companyKey: "yoga" }) })).rejects.toThrow("NOT_FOUND");
});
it("scopes updates and deletes to the authorized company", async () => {
  await saveTrainer("yoga", "trainer-1", {}, form({ companyId: "foreign", userId: "foreign" }));
  expect(db.trainer.updateMany).toHaveBeenCalledWith({ where: { id: "trainer-1", companyId: "company-1" }, data: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", userId: null } });
  await deleteTrainer("yoga", "trainer-1", {}, form({ confirmed: "yes" }));
  expect(db.trainer.deleteMany).toHaveBeenCalledWith({ where: { id: "trainer-1", companyId: "company-1", events: { none: {} }, suggestedForSeries: { none: {} } } });
});
it("rejects deletion without confirmation and invalid IDs", async () => {
  expect((await deleteTrainer("yoga", "trainer-1", {}, form())).success).toBeUndefined();
  expect((await deleteTrainer("yoga", "", {}, form({ confirmed: "yes" }))).success).toBeUndefined();
  expect((await saveTrainer("yoga", "", {}, form())).success).toBeUndefined();
  expect(db.trainer.updateMany).not.toHaveBeenCalled(); expect(db.trainer.deleteMany).not.toHaveBeenCalled();
});
it("does not report success for foreign or missing trainers and trainers still in use", async () => {
  db.trainer.updateMany.mockResolvedValue({ count: 0 }); db.trainer.deleteMany.mockResolvedValue({ count: 0 });
  expect((await saveTrainer("yoga", "foreign", {}, form())).success).toBeUndefined();
  expect((await deleteTrainer("yoga", "foreign", {}, form({ confirmed: "yes" }))).success).toBeUndefined();
});
it("provides a field error for duplicate company/email pairs", async () => {
  db.trainer.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" }));
  const result = await saveTrainer("yoga", null, {}, form());
  expect(result.success).toBeUndefined(); expect(result.errors?.email).toHaveLength(1);
});
it("handles a concurrent event assignment preventing deletion", async () => {
  db.trainer.deleteMany.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("reference", { code: "P2003", clientVersion: "test" }));
  const result = await deleteTrainer("yoga", "trainer-1", {}, form({ confirmed: "yes" }));
  expect(result.success).toBeUndefined(); expect(result.message).toContain("verwendet");
});
it.each<Record<string, string>>([{ firstName: " " }, { lastName: " " }, { email: "bad" }, { firstName: "x".repeat(161) }])("validates trainer inputs %j", async (invalid) => {
  expect(trainerSchema.safeParse({ ...values, ...invalid }).success).toBe(false);
  expect((await saveTrainer("yoga", null, {}, form(invalid))).errors).toBeDefined();
  expect(db.trainer.create).not.toHaveBeenCalled();
});
it("selects only company trainers and display fields", async () => {
  await getCompanyTrainers("yoga");
  expect(db.trainer.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId: "company-1" }, select: { id: true, number: true, firstName: true, lastName: true, email: true, _count: { select: { events: true, suggestedForSeries: true } } } }));
});
it("limits the admin-page company selector to active memberships", async () => {
  await getTrainerCompanies();
  expect(db.company.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { memberships: { some: { userId: "actor", status: "ACTIVE" } } } }));
  await expect(AdminPage({ searchParams: Promise.resolve({ company: "foreign" }) })).rejects.toThrow("NOT_FOUND");
  expect(db.trainer.findMany).not.toHaveBeenCalled();
});
it("allows global admins to select any company", async () => {
  db.user.findUnique.mockResolvedValue({ role: "ADMIN" });
  await getTrainerCompanies();
  expect(db.company.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
});
it("renders create and empty states on both entry points for company users", async () => {
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ companyKey: "yoga" }) }));
  expect(html).toContain("+ Trainer erstellen"); expect(html).toContain("Noch keine Trainer vorhanden");
  const admin = renderToStaticMarkup(await AdminPage({ searchParams: Promise.resolve({}) }));
  expect(admin).toContain('name="company"'); expect(admin).toContain("+ Trainer erstellen");
});
it("renders trainer details and disables deleting a trainer in use", async () => {
  db.trainer.findMany.mockResolvedValue([{ id: "trainer-1", number: 1, firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", _count: { events: 1, suggestedForSeries: 0 } }]);
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ companyKey: "yoga" }) }));
  expect(html).toContain("Lovelace"); expect(html).toContain("ada@example.com");
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Ada Lovelace löschen"/);
});
it("redirects unauthenticated users before trainer data is queried", async () => {
  auth.mockResolvedValue(null);
  await expect(Page({ params: Promise.resolve({ companyKey: "yoga" }) })).rejects.toThrow("LOGIN");
  await expect(AdminPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("LOGIN");
  expect(db.trainer.findMany).not.toHaveBeenCalled(); expect(db.company.findMany).not.toHaveBeenCalled();
});
it("shows an empty company state and a recoverable database-error state", async () => {
  db.company.findMany.mockResolvedValue([]);
  expect(renderToStaticMarkup(await AdminPage({ searchParams: Promise.resolve({}) }))).toContain("keine Company");
  db.trainer.findMany.mockRejectedValue(new Error("database unavailable"));
  expect(renderToStaticMarkup(await Page({ params: Promise.resolve({ companyKey: "yoga" }) }))).toContain("Erneut versuchen");
});

it.each([null, new Date()])("links trainer accounts only when verified: %s", async (emailVerified) => {
 db.user.findMany.mockResolvedValue([{ id: "matched", emailVerified }]);
 await saveTrainer("yoga", null, {}, form());
 expect(db.trainer.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: emailVerified ? "matched" : null }) }));
});
