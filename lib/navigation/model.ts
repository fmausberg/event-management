import type { CompanyRole, MembershipStatus, UserRole } from "@prisma/client";

export type NavigationIcon = "calendar" | "calendar-check" | "camera" | "venue" | "series" | "users" | "settings" | "company";
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

export function buildNavigation(user: NavigationUser, canScanTickets = false): NavigationData {
  const groups: NavigationGroup[] = [{
    id: "general", label: "Allgemein",
    items: [
      { label: "Zu den Veranstaltungen", href: "/events", icon: "calendar" },
      { label: "Meine Buchungen", href: "/account/bookings", icon: "calendar-check" },
      { label: "Check-In Management", href: "/account/events", icon: "calendar-check" },
    ],
  }];
  if (canScanTickets) groups[0].items.push({ label: "Ticket Scannen", href: "/account/scan", icon: "camera" });

  for (const membership of user.memberships) {
    if (membership.status !== "ACTIVE") continue;
    const company = membership.company;
    const base = `/company/${encodeURIComponent(company.slug)}`;
    const items: NavigationItem[] = [
      { label: "Veranstaltungsreihen", href: `${base}/event-series`, icon: "series" },
      { label: "Veranstaltungen", href: `${base}/events`, icon: "calendar" },
      { label: "Orte", href: `${base}/venues`, icon: "venue" },
      { label: "Trainer", href: `${base}/trainers`, icon: "users" },
      { label: "Stornierungen", href: `${base}/cancellations`, icon: "calendar-check" },
      { label: "Gutscheine", href: `${base}/vouchers`, icon: "calendar-check" },
    ];
    if (user.role === "ADMIN" || membership.role === "COMPANY_ADMIN") items.push(
      { label: "Einstellungen", href: `${base}/settings`, icon: "settings" },
      { label: "Mitglieder", href: `${base}/members`, icon: "users" },
    );
    groups.push({ id: `company:${company.id}`, label: company.name, items });
  }

  if (user.role === "ADMIN") groups.push({
    id: "admin", label: "Administration",
    items: [
      { label: "Companies", href: "/admin/companies", icon: "company" },
      { label: "Gutscheine", href: "/admin/vouchers", icon: "calendar-check" },
      { label: "Orte", href: "/admin/venues", icon: "venue" },
      { label: "Veranstaltungsreihen", href: "/admin/event-series", icon: "series" },
      { label: "Veranstaltungen", href: "/admin/events", icon: "calendar" },
      { label: "Benutzer", href: "/admin/users", icon: "users" },
      { label: "Trainer", href: "/admin/trainers", icon: "users" },
    ],
  });
  return { user: { name: user.name, email: user.email }, groups };
}

export function isNavigationItemActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
