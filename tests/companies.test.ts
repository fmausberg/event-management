import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { createCompany, updateCompany, deleteCompany } from "@/app/admin/companies/actions";
import { getCompaniesForAdmin } from "@/lib/companies/get-companies";
import { companySchema, suggestCompanySlug } from "@/lib/companies/validation";
import AdminCompaniesPage from "@/app/admin/companies/page";

const { auth, db, revalidatePath } = vi.hoisted(() => ({
  auth: vi.fn(), revalidatePath: vi.fn(),
  db: {
    user: { findUnique: vi.fn() },
    company: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
  },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));

function form(overrides: Record<string, string> = {}) {
  const data = new FormData();
  Object.entries({ name: "  Studio Berlin  ", slug: "  STUDIO-BERLIN  ", number: "999", id: "injected", confirmed: "yes", ...overrides })
    .forEach(([key, value]) => data.set(key, value));
  return data;
}
beforeEach(() => {
  auth.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
  db.user.findUnique.mockResolvedValue({ id: "admin-1", role: "ADMIN" });
  db.company.findMany.mockResolvedValue([]);
  db.company.findFirst.mockResolvedValue(null);
  db.company.findUnique.mockResolvedValue({ id: "company-1" });
  db.company.create.mockResolvedValue({ id: "company-1" });
  db.company.update.mockResolvedValue({ id: "company-1" });
  db.company.deleteMany.mockResolvedValue({ count: 1 });
});

describe("admin access", () => {
  it("rejects guests before reading or changing company data", async () => {
    auth.mockResolvedValue(null);
    await expect(getCompaniesForAdmin()).rejects.toThrow("Bitte melde dich");
    expect((await createCompany({}, form())).message).toContain("Bitte melde dich");
    expect((await updateCompany("company-1", {}, form())).message).toContain("Bitte melde dich");
    expect((await deleteCompany("company-1", {}, form())).message).toContain("Bitte melde dich");
    for (const method of Object.values(db.company)) expect(method).not.toHaveBeenCalled();
  });
  it("uses the current global DB role rather than claims or company-admin status", async () => {
    db.user.findUnique.mockResolvedValue({ id: "admin-1", role: "USER", memberships: [{ role: "COMPANY_ADMIN" }] });
    await expect(getCompaniesForAdmin()).rejects.toThrow("Administratorrechte");
    expect((await createCompany({}, form({ role: "ADMIN" }))).message).toContain("Administratorrechte");
    expect((await updateCompany("company-1", {}, form())).message).toContain("Administratorrechte");
    expect((await deleteCompany("company-1", {}, form())).message).toContain("Administratorrechte");
    for (const method of Object.values(db.company)) expect(method).not.toHaveBeenCalled();
  });
  it("denies deleted users", async () => {
    db.user.findUnique.mockResolvedValue(null);
    expect((await createCompany({}, form())).message).toContain("Administratorrechte");
    expect(db.company.create).not.toHaveBeenCalled();
  });
  it("redirects guest page requests and hides the page from ordinary users", async () => {
    auth.mockResolvedValue(null);
    await expect(AdminCompaniesPage()).rejects.toThrow("REDIRECT:/login");
    auth.mockResolvedValue({ user: { id: "user-1" } });
    db.user.findUnique.mockResolvedValue({ id: "user-1", role: "USER" });
    await expect(AdminCompaniesPage()).rejects.toThrow("NOT_FOUND");
  });
});

describe("company CRUD", () => {
  it("reads all companies in deterministic order with relation counts", async () => {
    const rows = [{ id: "a", name: "A" }, { id: "b", name: "B" }];
    db.company.findMany.mockResolvedValue(rows);
    expect(await getCompaniesForAdmin()).toEqual(rows);
    expect(db.company.findMany).toHaveBeenCalledWith({
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, number: true, name: true, slug: true,
        _count: { select: { memberships: true, venues: true, eventSeries: true, events: true } },
      },
    });
  });
  it("creates only editable normalized fields and refreshes table and sidebar", async () => {
    expect((await createCompany({}, form())).success).toBe(true);
    expect(db.company.create).toHaveBeenCalledWith({ data: { name: "Studio Berlin", slug: "studio-berlin" }, select: { id: true } });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/companies");
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
  it("updates only the specified company and allows retaining its own slug", async () => {
    expect((await updateCompany("company-1", {}, form())).success).toBe(true);
    expect(db.company.update).toHaveBeenCalledWith({ where: { id: "company-1" }, data: { name: "Studio Berlin", slug: "studio-berlin" }, select: { id: true } });
    expect(db.company.findFirst).toHaveBeenCalledWith({ where: { slug: { equals: "studio-berlin", mode: "insensitive" }, id: { not: "company-1" } }, select: { id: true } });
    expect(db.company.create).not.toHaveBeenCalled();
  });
  it.each([null, undefined, "", " "])("rejects invalid IDs %j without broad mutations or accidental creation", async (id) => {
    expect((await updateCompany(id as string, {}, form())).message).toContain("Company-ID");
    expect((await deleteCompany(id as string, {}, form())).message).toContain("Company-ID");
    expect(db.company.update).not.toHaveBeenCalled();
    expect(db.company.deleteMany).not.toHaveBeenCalled();
    expect(db.company.create).not.toHaveBeenCalled();
  });
  it("rejects invalid names and slugs and retains entered values", async () => {
    const result = await createCompany({}, form({ name: "  ", slug: "not/a/path" }));
    expect(result.errors?.name).toBeTruthy();
    expect(result.errors?.slug).toBeTruthy();
    expect(result.values?.slug).toBe("not/a/path");
    expect(db.company.create).not.toHaveBeenCalled();
  });
  it("reports duplicates including legacy mixed-case slugs and concurrent inserts", async () => {
    db.company.findFirst.mockResolvedValueOnce({ id: "existing" });
    expect((await createCompany({}, form())).errors?.slug).toBeTruthy();
    expect(db.company.create).not.toHaveBeenCalled();
    db.company.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("private", { code: "P2002", clientVersion: "7" }));
    expect((await createCompany({}, form())).errors?.slug).toBeTruthy();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("reports concurrent deletion and hides unexpected database errors", async () => {
    db.company.update.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("private", { code: "P2025", clientVersion: "7" }));
    expect((await updateCompany("missing", {}, form())).message).toContain("existiert nicht mehr");
    db.company.create.mockRejectedValueOnce(new Error("postgresql://secret"));
    const result = await createCompany({}, form());
    expect(result.message).toContain("nicht gespeichert");
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("requires explicit deletion confirmation", async () => {
    expect((await deleteCompany("company-1", {}, form({ confirmed: "" }))).message).toContain("bestätige");
    expect(db.company.deleteMany).not.toHaveBeenCalled();
  });
  it("deletes only the requested company without any dependent records", async () => {
    expect((await deleteCompany("company-1", {}, form())).success).toBe(true);
    expect(db.company.deleteMany).toHaveBeenCalledWith({ where: { id: "company-1", memberships: { none: {} }, venues: { none: {} }, eventSeries: { none: {} }, events: { none: {} } } });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/companies");
  });
  it("reports dependencies, a missing company, and concurrent foreign key inserts", async () => {
    db.company.deleteMany.mockResolvedValue({ count: 0 });
    expect((await deleteCompany("company-1", {}, form())).message).toContain("noch Mitglieder");
    db.company.findUnique.mockResolvedValue(null);
    expect((await deleteCompany("company-1", {}, form())).message).toContain("existiert nicht mehr");
    db.company.deleteMany.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("private", { code: "P2003", clientVersion: "7" }));
    expect((await deleteCompany("company-1", {}, form())).message).toContain("noch Mitglieder");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

it("suggests readable slugs and rejects invalid URL segments", () => {
  expect(suggestCompanySlug(" Müller & Söhne GmbH ")).toBe("mueller-soehne-gmbh");
  expect(suggestCompanySlug("Café Berlin")).toBe("cafe-berlin");
  for (const slug of ["/company", "..", "two words", "-first", "last-", "two--dashes", "x".repeat(101)]) {
    expect(companySchema.safeParse({ name: "Test", slug }).success).toBe(false);
  }
});
