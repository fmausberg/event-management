import type { CompanyRole, MembershipStatus, UserRole } from "@prisma/client";

export type NavigationIcon = "calendar" | "venue" | "series" | "users" | "settings" | "company";
export type NavigationItem = { label: string; href: string; icon: NavigationIcon };
export type NavigationGroup = { id: string; label: string; items: NavigationItem[] };
export type NavigationData = {
  user: { name: string | null; email: string };
  groups: NavigationGroup[];
};
export type NavigationUser = {
  name: string | null;
  email: string;
  role: UserRole;
  memberships: {
    role: CompanyRole;
    status: MembershipStatus;
    company: { id: string; name: string; slug: string };
  }[];
};

export function buildNavigation(user: NavigationUser): NavigationData {
  const groups: NavigationGroup[] = [{
    id: "general", label: "Allgemein",
    items: [{ label: "Events", href: "/events", icon: "calendar" }],
  }];

  for (const membership of user.memberships) {
    if (membership.status !== "ACTIVE") continue;
    const company = membership.company;
    const base = `/company/${encodeURIComponent(company.slug)}`;
    const items: NavigationItem[] = [
      { label: "Venues", href: `${base}/venues`, icon: "venue" },
      { label: "Event-Series", href: `${base}/event-series`, icon: "series" },
    ];
    if (membership.role === "COMPANY_ADMIN") items.push(
      { label: "Settings", href: `${base}/settings`, icon: "settings" },
      { label: "Members", href: `${base}/members`, icon: "users" },
    );
    groups.push({ id: `company:${company.id}`, label: company.name, items });
  }

  if (user.role === "ADMIN") groups.push({
    id: "admin", label: "Administration",
    items: [
      { label: "Companies", href: "/admin/companies", icon: "company" },
      { label: "Venues", href: "/admin/venues", icon: "venue" },
      { label: "Event-Series", href: "/admin/event-series", icon: "series" },
      { label: "Events", href: "/admin/events", icon: "calendar" },
      { label: "User", href: "/admin/users", icon: "users" },
    ],
  });
  return { user: { name: user.name, email: user.email }, groups };
}

export function isNavigationItemActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
