import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import AccountPage from "@/app/account/page";

const { auth, findMany, venues, events, redirect } = vi.hoisted(() => ({
  venues: vi.fn(), events: vi.fn(),
  auth: vi.fn(),
  findMany: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth }));
vi.mock("@/app/(auth)/actions", () => ({ logout: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => ({ booking: { findMany }, venueStaff: { findMany: venues }, eventStaff: { findMany: events } }) }));
vi.mock("next/navigation", () => ({ redirect }));

beforeEach(() => {
  vi.resetAllMocks();
  venues.mockResolvedValue([]); events.mockResolvedValue([]); findMany.mockResolvedValue([]);
  auth.mockResolvedValue({ user: { id: "user-1", name: "Ada", email: "ada@example.com" } });
});

it("shows the signed-in user's bookings without the event overview link", async () => {
  findMany.mockResolvedValue([{
    id: "booking-1",
    number: 42,
    quantity: 2,
    status: "CONFIRMED",
    event: { name: "Yoga", beginsAt: new Date("2026-10-16T08:00:00Z") },
  }]);

  const html = renderToStaticMarkup(await AccountPage());

  expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { userId: "user-1" },
    orderBy: [{ bookedAt: "desc" }, { id: "asc" }],
  }));
  expect(html).toContain("Meine Buchungen");
  expect(html).toContain("Yoga");
  expect(html).toContain("#42");
  expect(html).toContain("Bestätigt");
  expect(html).not.toContain("Zur Eventübersicht");
  expect(html.indexOf("Abmelden")).toBeLessThan(html.indexOf("Meine Buchungen"));
});

it("shows an empty state when the user has no bookings", async () => {
  findMany.mockResolvedValue([]);

  const html = renderToStaticMarkup(await AccountPage());

  expect(html).toContain("Du hast noch keine Buchungen.");
  expect(html).not.toContain("Meine VenueStaff-Einteilungen");
  expect(html).not.toContain("Meine EventStaff-Einteilungen");
});

it("shows only personal staff assignments below bookings with company and event link", async () => {
 venues.mockResolvedValue([{ id: "v1", venue: { name: "Studio", company: { name: "Venue Company" } }, assignedBy: { email: "venue-admin@example.com" } }]);
 events.mockResolvedValue([{ id: "e1", event: { id: "event-1", name: "Event Yoga", beginsAt: new Date("2026-10-16T08:00:00Z"), company: { name: "Event Company", slug: "yoga" } }, assignedBy: { email: "event-admin@example.com" } }]);
 const html = renderToStaticMarkup(await AccountPage());
 for (const query of [venues, events]) expect(query).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "user-1" } }));
 for (const value of ["Studio", "Venue Company", "Event Company", "venue-admin@example.com", "event-admin@example.com", "16.10.2026, 10:00"]) expect(html).toContain(value);
 expect(html).toContain('href="/events/yoga/event-1"');
 expect(html.indexOf("Meine Buchungen")).toBeLessThan(html.indexOf("Meine VenueStaff-Einteilungen"));
 expect(html.indexOf("Meine VenueStaff-Einteilungen")).toBeLessThan(html.indexOf("Meine EventStaff-Einteilungen"));
});

it("rejects sessions without an account ID before querying bookings", async () => {
 auth.mockResolvedValue({ user: { email: "ada@example.com" } });
 redirect.mockImplementation(() => { throw new Error("LOGIN"); });
 await expect(AccountPage()).rejects.toThrow("LOGIN");
 expect(findMany).not.toHaveBeenCalled();
 expect(venues).not.toHaveBeenCalled(); expect(events).not.toHaveBeenCalled();
});
