import { PublicHeader } from "@/components/public-events";
import { beforeEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getPublicEvents } from "@/lib/events/public-events";
import Page from "@/app/(public)/events/page";
import { NavigationShell } from "@/components/navigation-shell";
const { findMany, groupBy, pathname } = vi.hoisted(() => ({ findMany: vi.fn(), groupBy: vi.fn(), pathname: vi.fn() }));
vi.mock("@/auth", () => ({ auth: async () => null }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => ({ event: { findMany }, booking: { groupBy } }) }));
vi.mock("next/navigation", () => ({ usePathname: pathname }));
vi.mock("@/app/(auth)/actions", () => ({ logout: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); pathname.mockReturnValue("/events"); findMany.mockResolvedValue([]); groupBy.mockResolvedValue([]); });
it("queries only published events and selects no private data", async () => {
 await getPublicEvents();
 expect(findMany).toHaveBeenCalledWith({ where: { status: "PUBLISHED" }, orderBy: [{ beginsAt: "asc" }, { id: "asc" }], select: {
  id: true, name: true, shortdescription: true, beginsAt: true, ticketPrice: true, currency: true, maxSeats: true, company: { select: { name: true, slug: true } }, venue: { select: { name: true, city: true } }, eventSeries: { select: { imageUrl: true } },
 } });
});
it("renders cards, prices, dates, links and the requested menu", async () => {
 findMany.mockResolvedValue([{ id: "event-1", maxSeats: 10, name: "Yoga", shortdescription: "Entspannung", beginsAt: new Date("2026-10-16T08:00:00Z"), ticketPrice: { toFixed: () => "19.50" }, currency: "EUR", company: { name: "Studio", slug: "studio" }, venue: { name: "Saal", city: "Berlin" }, eventSeries: { imageUrl: null } }]);
 const html = renderToStaticMarkup(await Page());
 expect(html).toContain("Yoga"); expect(html).toContain("19,50"); expect(html).toContain("Fr., 16.10.2026, 10:00");
 expect(html).toContain('href="/events/studio/event-1"');
 for (const label of ["Einloggen", "Registrieren", "Event-Management"]) expect(html).toContain(label);
});
it("shows distinct empty and error states", async () => {
 expect(renderToStaticMarkup(await Page())).toContain("Noch keine veröffentlichten Events");
 findMany.mockRejectedValue(new Error("offline"));
 expect(renderToStaticMarkup(await Page())).toContain("konnten gerade nicht geladen werden");
});
it.each([10, 12])("disables the card button when %i seats are booked out of 10", async (quantity) => {
 findMany.mockResolvedValue([{ id: "event-1", maxSeats: 10, name: "Yoga", shortdescription: null, beginsAt: new Date("2026-10-16T08:00:00Z"), ticketPrice: { toFixed: () => "19.50" }, currency: "EUR", company: { name: "Studio", slug: "studio" }, venue: null, eventSeries: null }]);
 groupBy.mockResolvedValue([{ eventId: "event-1", _sum: { quantity } }]);
 const html = renderToStaticMarkup(await Page());
 expect(html).toMatch(/<button[^>]*disabled=""[^>]*>ausgebucht<\/button>/);
 expect(html).not.toContain('aria-label="Details zu Yoga"');
 expect(groupBy).toHaveBeenCalledWith({ by: ["eventId"], where: { eventId: { in: ["event-1"] }, status: "CONFIRMED" }, _sum: { quantity: true } });
 groupBy.mockResolvedValue([{ eventId: "event-1", _sum: { quantity: 9 } }]);
 const available = renderToStaticMarkup(await Page());
 expect(available).not.toContain("ausgebucht");
 expect(available).toContain('aria-label="Details zu Yoga"');
});
it("hides the management sidebar for signed-in visitors", () => {
 const html = renderToStaticMarkup(createElement(NavigationShell, { data: { user: { name: "Ada", email: "ada@example.com" }, groups: [] } }, "Public content"));
 expect(html).toBe("Public content");
});

it("shows profile and management links only when signed in", () => {
 const html = renderToStaticMarkup(createElement(PublicHeader, { signedIn: true }));
 expect(html).toMatch(/href="\/account"[^>]*>Zur Plattform<\/a>/); expect(html).toContain("Mein Profil"); expect(html).toContain('href="/account"');
 expect(html).toContain("Event-Management"); expect(html).toContain('href="/"');
 expect(html).not.toContain("Einloggen"); expect(html).not.toContain("Registrieren");
});
