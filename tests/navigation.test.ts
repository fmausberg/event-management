import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildNavigation, isNavigationItemActive, type NavigationUser } from "@/lib/navigation/model";
import { getNavigation } from "@/lib/navigation/get-navigation";

const { auth, findUnique } = vi.hoisted(() => ({ auth: vi.fn(), findUnique: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => ({ user: { findUnique } }) }));

const user: NavigationUser = {
  name: "Ada", email: "ada@example.com", role: "USER", memberships: [
    { role: "COMPANY_USER", status: "ACTIVE", company: { id: "company-a", slug: "slug-company-a", name: "Company A" } },
    { role: "COMPANY_ADMIN", status: "ACTIVE", company: { id: "company-b", slug: "slug-company-b", name: "Company B" } },
    { role: "COMPANY_ADMIN", status: "INVITED", company: { id: "invited", slug: "slug-invited", name: "Invited" } },
    { role: "COMPANY_ADMIN", status: "SUSPENDED", company: { id: "suspended", slug: "slug-suspended", name: "Suspended" } },
  ],
};
beforeEach(() => {
  auth.mockResolvedValue({ user: { id: "user-1" } });
  findUnique.mockResolvedValue(user);
});

describe("navigation visibility", () => {
  it("always links public events and uses company slugs for active memberships", () => {
    const result = buildNavigation(user);
    expect(result.groups.map((group) => group.label)).toEqual(["Allgemein", "Company A", "Company B"]);
    expect(result.groups[0].items.map((item) => item.href)).toEqual(["/events"]);
    expect(result.groups[1].items.map((item) => item.href)).toEqual([
      "/company/slug-company-a/venues", "/company/slug-company-a/event-series", "/company/slug-company-a/events",
    ]);
    expect(result.groups[2].items.map((item) => item.href)).toEqual([
      "/company/slug-company-b/venues", "/company/slug-company-b/event-series",
      "/company/slug-company-b/events", "/company/slug-company-b/settings", "/company/slug-company-b/members",
    ]);
  });

  it("shows the global admin links only to ADMIN without elevating company roles", () => {
    expect(buildNavigation(user).groups.some((group) => group.id === "admin")).toBe(false);
    const result = buildNavigation({ ...user, role: "ADMIN" });
    expect(result.groups.find((group) => group.id === "admin")?.items.map((item) => item.href)).toEqual([
      "/admin/companies", "/admin/venues", "/admin/event-series", "/admin/events", "/admin/users",
    ]);
    expect(result.groups[1].items).toHaveLength(3);
  });

  it("supports users without companies and keeps identical company names separate", () => {
    expect(buildNavigation({ ...user, memberships: [] }).groups).toHaveLength(1);
    const memberships = user.memberships.slice(0, 2).map((membership) => ({
      ...membership, company: { ...membership.company, name: "Same name" },
    }));
    const result = buildNavigation({ ...user, memberships });
    expect(result.groups[1].id).not.toBe(result.groups[2].id);
  });

  it("does not send database roles or arbitrary private fields to the client", () => {
    const result = buildNavigation({ ...user, passwordHash: "private-hash" } as NavigationUser);
    expect(result.user).toEqual({ name: "Ada", email: "ada@example.com" });
    expect(JSON.stringify(result)).not.toContain("private-hash");
    expect(JSON.stringify(result)).not.toContain("COMPANY_ADMIN");
  });
});

describe("server-side identity", () => {
  it("does not query navigation data for guests", async () => {
    auth.mockResolvedValue(null);
    expect(await getNavigation()).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });
  it("uses the session identity and selects only active memberships and required fields", async () => {
    expect(await getNavigation()).toEqual(buildNavigation(user));
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: {
        name: true, email: true, role: true,
        memberships: {
          where: { status: "ACTIVE" },
          orderBy: [{ company: { name: "asc" } }, { companyId: "asc" }],
          select: { role: true, status: true, company: { select: { id: true, name: true, slug: true } } },
        },
      },
    });
  });
  it("does not render navigation for a deleted user", async () => {
    findUnique.mockResolvedValue(null);
    expect(await getNavigation()).toBeNull();
  });
});

describe("active navigation", () => {
  it("matches descendants without confusing public, admin, or similarly named routes", () => {
    expect(isNavigationItemActive("/events/123", "/events")).toBe(true);
    expect(isNavigationItemActive("/admin/events/123/edit", "/admin/events")).toBe(true);
    expect(isNavigationItemActive("/admin/events", "/events")).toBe(false);
    expect(isNavigationItemActive("/events-other", "/events")).toBe(false);
    expect(isNavigationItemActive("/company/a/venues", "/company/b/venues")).toBe(false);
  });
});
