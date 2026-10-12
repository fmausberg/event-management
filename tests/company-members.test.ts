import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { renderToStaticMarkup } from "react-dom/server";
import { getCompanyMembers, requireCompanyAdmin } from "@/lib/companies/members";
import { claimMemberships } from "@/lib/companies/claim-memberships";
import { addCompanyMember, changeMemberRole, removeCompanyMember } from "@/app/company/[companyKey]/members/actions";
import CompanyMembersPage from "@/app/company/[companyKey]/members/page";

const { auth, db, revalidatePath } = vi.hoisted(() => ({
  auth: vi.fn(), revalidatePath: vi.fn(),
  db: {
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    company: { findUnique: vi.fn() },
    companyMembership: { findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
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

function form(email = "  ADA@Example.com  ") {
  const data = new FormData(); data.set("email", email); data.set("role", "COMPANY_ADMIN"); return data;
}
beforeEach(() => {
  vi.resetAllMocks();
  auth.mockResolvedValue({ user: { id: "actor", role: "ADMIN" } });
  db.user.findUnique.mockResolvedValue({ role: "ADMIN" });
  db.user.findMany.mockResolvedValue([]);
  db.company.findUnique.mockResolvedValue({ id: "company-a", name: "Company A", slug: "studio-berlin" });
  db.companyMembership.findUnique.mockResolvedValue(null);
  db.companyMembership.findFirst.mockResolvedValue(null);
  db.companyMembership.findMany.mockResolvedValue([]);
  db.companyMembership.create.mockResolvedValue({ id: "membership-1" });
});

describe("company member permissions", () => {
  it("allows global admins without company membership", async () => {
    await expect(requireCompanyAdmin("studio-berlin")).resolves.toEqual({ id: "company-a", name: "Company A", slug: "studio-berlin" });
    expect(db.company.findUnique).toHaveBeenCalledWith({ where: { slug: "studio-berlin" }, select: { id: true, name: true, slug: true } });
    expect(db.companyMembership.findUnique).not.toHaveBeenCalled();
  });
  it("allows only an active admin membership in the requested company", async () => {
    db.user.findUnique.mockResolvedValue({ role: "USER" });
    db.companyMembership.findUnique.mockResolvedValue({ role: "COMPANY_ADMIN", status: "ACTIVE" });
    await expect(requireCompanyAdmin("studio-berlin")).resolves.toBeDefined();
    expect(db.companyMembership.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId_userId: { companyId: "company-a", userId: "actor" } } }));
  });
  it.each([null, { role: "COMPANY_USER", status: "ACTIVE" }, { role: "COMPANY_ADMIN", status: "SUSPENDED" }, { role: "COMPANY_ADMIN", status: "INVITED" }])("rejects missing or insufficient membership %j on reads and writes", async (membership) => {
    db.user.findUnique.mockResolvedValue({ role: "USER" });
    db.companyMembership.findUnique.mockResolvedValue(membership);
    await expect(getCompanyMembers("studio-berlin")).rejects.toThrow("nicht verwalten");
    expect((await addCompanyMember("studio-berlin", {}, form())).message).toContain("nicht verwalten");
    expect(db.companyMembership.findMany).not.toHaveBeenCalled();
    expect(db.companyMembership.create).not.toHaveBeenCalled();
  });
  it("rejects guests and deleted users", async () => {
    auth.mockResolvedValue(null);
    await expect(getCompanyMembers("studio-berlin")).rejects.toThrow("melde dich");
    expect((await addCompanyMember("studio-berlin", {}, form())).message).toContain("melde dich");
    auth.mockResolvedValue({ user: { id: "deleted" } });
    db.user.findUnique.mockResolvedValue(null);
    await expect(requireCompanyAdmin("studio-berlin")).rejects.toThrow("nicht verwalten");
  });
  it("redirects guests and hides forbidden and missing companies", async () => {
    const props = { params: Promise.resolve({ companyKey: "studio-berlin" }) };
    auth.mockResolvedValue(null);
    await expect(CompanyMembersPage(props)).rejects.toThrow("REDIRECT:/login");
    auth.mockResolvedValue({ user: { id: "actor" } });
    db.user.findUnique.mockResolvedValue({ role: "USER" });
    await expect(CompanyMembersPage(props)).rejects.toThrow("NOT_FOUND");
    db.user.findUnique.mockResolvedValue({ role: "ADMIN" });
    db.company.findUnique.mockResolvedValue(null);
    await expect(CompanyMembersPage(props)).rejects.toThrow("NOT_FOUND");
  });
});

describe("adding and listing company members", () => {
  it("renders an empty table and the add-member form when no members exist", async () => {
    const page = await CompanyMembersPage({ params: Promise.resolve({ companyKey: "studio-berlin" }) });
    const html = renderToStaticMarkup(page);
    expect(html).toContain("Noch keine Mitglieder vorhanden.");
    expect(html).toContain("<table");
    expect(html).toContain("<tbody></tbody>");
    expect(html).toContain('name="email"');
    expect(html).toContain("Mitglied hinzufügen");
    expect(html).not.toContain("konnten gerade nicht geladen werden");
  });
  it("does not present a database failure as an empty membership list", async () => {
    db.companyMembership.findMany.mockRejectedValue(new Error("Database unavailable"));
    const html = renderToStaticMarkup(await CompanyMembersPage({ params: Promise.resolve({ companyKey: "studio-berlin" }) }));
    expect(html).toContain("konnten gerade nicht geladen werden");
    expect(html).not.toContain("Noch keine Mitglieder vorhanden.");
  });
  it("stores a normalized pending address without creating a fake user or accepting role injection", async () => {
    expect(await addCompanyMember("studio-berlin", {}, form())).toMatchObject({ success: true });
    expect(db.companyMembership.create).toHaveBeenCalledWith({ data: { companyId: "company-a", email: "ada@example.com", userId: null, role: "COMPANY_USER", status: "INVITED" } });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/companies");
    expect(revalidatePath).toHaveBeenCalledWith("/company/studio-berlin/members");
  });
  it("links an existing account", async () => {
    db.user.findMany.mockResolvedValue([{ id: "user-2", email: "ada@example.com", emailVerified: null }]);
    await addCompanyMember("studio-berlin", {}, form());
    expect(db.companyMembership.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: "user-2", status: "ACTIVE" }) });
    expect(db.companyMembership.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId: "company-a", OR: [{ email: "ada@example.com" }, { userId: "user-2" }] } }));
  });
  it("rejects invalid addresses, duplicates, and ambiguous legacy identities", async () => {
    expect((await addCompanyMember("studio-berlin", {}, form("invalid"))).success).toBeUndefined();
    db.companyMembership.findFirst.mockResolvedValue({ id: "existing" });
    expect((await addCompanyMember("studio-berlin", {}, form())).message).toContain("bereits zugeordnet");
    db.user.findMany.mockResolvedValue([{ id: "one" }, { id: "two" }]);
    expect((await addCompanyMember("studio-berlin", {}, form())).success).toBeUndefined();
    expect(db.companyMembership.create).not.toHaveBeenCalled();
  });
  it("handles concurrent duplicate inserts", async () => {
    db.companyMembership.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" }));
    expect((await addCompanyMember("studio-berlin", {}, form())).message).toContain("bereits zugeordnet");
  });
  it("shows all three account statuses, including newly registered pending members", async () => {
    db.companyMembership.findMany.mockResolvedValue([
      { id: "1", email: "missing@example.com", user: null },
      { id: "2", email: null, user: { email: "unverified@example.com", emailVerified: null } },
      { id: "3", email: null, user: { email: "verified@example.com", emailVerified: new Date() } },
      { id: "4", email: "new@example.com", user: null },
    ]);
    db.user.findMany.mockResolvedValue([{ email: "NEW@example.com", emailVerified: null }]);
    const result = await getCompanyMembers("studio-berlin");
    expect(result.members.map((member) => member.status)).toEqual(["no account", "not verified", "verified", "not verified"]);
    expect(result.members[1].email).toBe("unverified@example.com");
    expect(db.companyMembership.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId: "company-a" } }));
  });
});

describe("claiming pending memberships", () => {
  it("never grants access through an unverified email", async () => {
    await claimMemberships({ id: "new-user", email: "ada@example.com", emailVerified: null });
    expect(db.companyMembership.updateMany).not.toHaveBeenCalled();
  });
  it("claims only matching pending memberships without replacing existing roles or suspensions", async () => {
    db.user.findMany.mockResolvedValue([{ id: "new-user" }]);
    await claimMemberships({ id: "new-user", email: "ADA@example.com", emailVerified: new Date() });
    expect(db.companyMembership.updateMany).toHaveBeenCalledWith({ where: { email: "ada@example.com", userId: null, status: "INVITED", company: { memberships: { none: { userId: "new-user" } } } }, data: { userId: "new-user", status: "ACTIVE" } });
  });
  it("does not claim ambiguous legacy email addresses", async () => {
    db.user.findMany.mockResolvedValue([{ id: "new-user" }, { id: "other" }]);
    await claimMemberships({ id: "new-user", email: "ada@example.com", emailVerified: new Date() });
    expect(db.companyMembership.updateMany).not.toHaveBeenCalled();
  });
  it("keeps login working during a concurrent membership assignment", async () => {
    db.user.findMany.mockResolvedValue([{ id: "new-user" }]);
    db.companyMembership.updateMany.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" }));
    await expect(claimMemberships({ id: "new-user", email: "ada@example.com", emailVerified: new Date() })).resolves.toBeUndefined();
  });
});


describe("company role changes", () => {
  it.each(["COMPANY_USER", "COMPANY_ADMIN"])("stores %s only on the target company membership", async (role) => {
    db.companyMembership.updateMany.mockResolvedValue({ count: 1 });
    const data = new FormData(); data.set("role", role);
    expect(await changeMemberRole("studio-berlin", "member-1", {}, data)).toMatchObject({ success: true });
    expect(db.companyMembership.updateMany).toHaveBeenCalledWith({ where: { id: "member-1", companyId: "company-a" }, data: { role } });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
  it("allows active company admins", async () => {
    db.user.findUnique.mockResolvedValue({ role: "USER" });
    db.companyMembership.findUnique.mockResolvedValue({ role: "COMPANY_ADMIN", status: "ACTIVE" });
    db.companyMembership.updateMany.mockResolvedValue({ count: 1 });
    expect((await changeMemberRole("studio-berlin", "member-1", {}, form())).success).toBe(true);
  });
  it.each([null, { role: "COMPANY_USER", status: "ACTIVE" }, { role: "COMPANY_ADMIN", status: "SUSPENDED" }])("denies insufficient membership %j", async (membership) => {
    db.user.findUnique.mockResolvedValue({ role: "USER" });
    db.companyMembership.findUnique.mockResolvedValue(membership);
    expect((await changeMemberRole("studio-berlin", "member-1", {}, form())).success).toBeUndefined();
    expect(db.companyMembership.updateMany).not.toHaveBeenCalled();
  });
  it("denies guests", async () => {
    auth.mockResolvedValue(null);
    expect((await changeMemberRole("studio-berlin", "member-1", {}, form())).success).toBeUndefined();
    expect(db.companyMembership.updateMany).not.toHaveBeenCalled();
  });
  it("rejects global roles and invalid member IDs", async () => {
    const data = new FormData(); data.set("role", "ADMIN");
    expect((await changeMemberRole("studio-berlin", "member-1", {}, data)).success).toBeUndefined();
    expect((await changeMemberRole("studio-berlin", "", {}, form())).success).toBeUndefined();
    expect(db.companyMembership.updateMany).not.toHaveBeenCalled();
  });
  it("reports deleted or other-company members without success", async () => {
    db.companyMembership.updateMany.mockResolvedValue({ count: 0 });
    expect((await changeMemberRole("studio-berlin", "foreign-member", {}, form())).success).toBeUndefined();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("reports failed writes", async () => {
    db.companyMembership.updateMany.mockRejectedValue(new Error("offline"));
    expect((await changeMemberRole("studio-berlin", "member-1", {}, form())).message).toContain("nicht gespeichert");
  });
  it("renders status colors and switches with persisted role state", async () => {
    db.companyMembership.findMany.mockResolvedValue([
      { id: "1", email: "missing@example.com", role: "COMPANY_USER", user: null },
      { id: "2", email: null, role: "COMPANY_ADMIN", user: { email: "unverified@example.com", emailVerified: null } },
      { id: "3", email: null, role: "COMPANY_USER", user: { email: "verified@example.com", emailVerified: new Date() } },
    ]);
    const html = renderToStaticMarkup(await CompanyMembersPage({ params: Promise.resolve({ companyKey: "studio-berlin" }) }));
    expect(html).toMatch(/bg-red-100[^>]*>no account/);
    expect(html).toMatch(/bg-yellow-100[^>]*>not verified/);
    expect(html).toMatch(/bg-green-100[^>]*>verified/);
    expect(html).toContain('role="switch" aria-checked="true"');
    expect(html).toContain('role="switch" aria-checked="false"');
    expect(html).toContain('name="role" value="COMPANY_USER"');
    expect(html).toContain('name="role" value="COMPANY_ADMIN"');
  });
});


describe("removing company memberships", () => {
  function confirmation() { const data = new FormData(); data.set("confirmed", "yes"); return data; }
  it("deletes only the selected membership in the authorized company", async () => {
    db.companyMembership.deleteMany.mockResolvedValue({ count: 1 });
    expect((await removeCompanyMember("studio-berlin", "member-1", {}, confirmation())).success).toBe(true);
    expect(db.companyMembership.deleteMany).toHaveBeenCalledWith({ where: { id: "member-1", companyId: "company-a" } });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/companies");
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });
  it("allows active company admins", async () => {
    db.user.findUnique.mockResolvedValue({ role: "USER" });
    db.companyMembership.findUnique.mockResolvedValue({ role: "COMPANY_ADMIN", status: "ACTIVE" });
    db.companyMembership.deleteMany.mockResolvedValue({ count: 1 });
    expect((await removeCompanyMember("studio-berlin", "member-1", {}, confirmation())).success).toBe(true);
  });
  it.each([null, { role: "COMPANY_USER", status: "ACTIVE" }, { role: "COMPANY_ADMIN", status: "SUSPENDED" }])("rejects insufficient company permissions %j", async (membership) => {
    db.user.findUnique.mockResolvedValue({ role: "USER" });
    db.companyMembership.findUnique.mockResolvedValue(membership);
    expect((await removeCompanyMember("studio-berlin", "member-1", {}, confirmation())).success).toBeUndefined();
    expect(db.companyMembership.deleteMany).not.toHaveBeenCalled();
  });
  it("rejects guests and unconfirmed or invalid requests", async () => {
    expect((await removeCompanyMember("studio-berlin", "member-1", {}, new FormData())).success).toBeUndefined();
    expect((await removeCompanyMember("studio-berlin", "", {}, confirmation())).success).toBeUndefined();
    auth.mockResolvedValue(null);
    expect((await removeCompanyMember("studio-berlin", "member-1", {}, confirmation())).success).toBeUndefined();
    expect(db.companyMembership.deleteMany).not.toHaveBeenCalled();
  });
  it("reports missing or foreign members and database failures", async () => {
    db.companyMembership.deleteMany.mockResolvedValue({ count: 0 });
    expect((await removeCompanyMember("studio-berlin", "foreign", {}, confirmation())).success).toBeUndefined();
    db.companyMembership.deleteMany.mockRejectedValue(new Error("offline"));
    expect((await removeCompanyMember("studio-berlin", "member-1", {}, confirmation())).message).toContain("nicht entfernt");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("renders an accessible delete control for each membership", async () => {
    db.companyMembership.findMany.mockResolvedValue([{ id: "member-1", email: "ada@example.com", role: "COMPANY_USER", user: null }]);
    const html = renderToStaticMarkup(await CompanyMembersPage({ params: Promise.resolve({ companyKey: "studio-berlin" }) }));
    expect(html).toContain('aria-label="Mitgliedschaft von ada@example.com entfernen"');
    expect(html).toContain('title="Mitgliedschaft entfernen"');
  });
});
