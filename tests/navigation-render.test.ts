import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { NavigationShell } from "@/components/navigation-shell";
import { buildNavigation } from "@/lib/navigation/model";

vi.mock("next/navigation", () => ({ usePathname: () => "/company/demo/venues" }));
vi.mock("@/app/(auth)/actions", () => ({ logout: async () => {} }));

it("renders company headings, active links and accessible account/menu controls", () => {
  const data = buildNavigation({ name: "Ada", email: "ada@example.com", role: "USER", memberships: [
    { role: "COMPANY_ADMIN", status: "ACTIVE", company: { id: "database-id", slug: "demo", name: "Demo Company" } },
  ] });
  const html = renderToStaticMarkup(createElement(NavigationShell, { data }, "Page content"));
  expect(html).toContain('aria-label="Hauptnavigation"');
  expect(html).toContain('aria-label="Demo Company"');
  expect(html).toMatch(/aria-current="page"[^>]*href="\/company\/demo\/venues"/);
  expect(html).toContain('href="/company/demo/settings"');
  expect(html).not.toContain('href="/admin/users"');
  expect(html).toContain('aria-label="Abmelden"');
  expect(html).toContain('href="/account"');
  expect(html).toContain('aria-expanded="true"');
  expect(html).toContain('<summary');
  expect(html).toContain('id="page-content"');
  expect(html).toContain('Page content');
});
