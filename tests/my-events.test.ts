import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getMyEvents } from "@/lib/account/events";
import Page from "@/app/account/events/page";
import { buildNavigation } from "@/lib/navigation/model";

const { auth, db } = vi.hoisted(() => ({ auth: vi.fn(), db: { user: { findUnique: vi.fn() }, event: { findMany: vi.fn() } } }));
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("LOGIN"); } }));
const event = { id: "event-1", name: "Yoga", beginsAt: new Date("2026-10-15T10:00:00Z"), endsAt: new Date("2026-10-15T11:00:00Z"), status: "PUBLISHED", company: { name: "Studio", slug: "studio" }, venue: null, staff: [] };
beforeEach(() => {
  vi.resetAllMocks(); auth.mockResolvedValue({ user: { id: "me" } });
  db.user.findUnique.mockResolvedValue({ id: "me", email: "ada@example.com" }); db.event.findMany.mockResolvedValue([]);
});
it("renames the personal menu entry without requiring a company or admin role", () => {
  const navigation = buildNavigation({ name: "Ada", email: "ada@example.com", role: "USER", memberships: [] });
  expect(navigation.groups[0].items).toContainEqual({ label: "Check-In Management", href: "/account/events", icon: "calendar-check" });
});
it("redirects guests and deleted accounts before querying events", async () => {
  auth.mockResolvedValue(null); await expect(getMyEvents()).rejects.toThrow("LOGIN");
  expect(db.user.findUnique).not.toHaveBeenCalled(); expect(db.event.findMany).not.toHaveBeenCalled();
  auth.mockResolvedValue({ user: { id: "deleted" } }); db.user.findUnique.mockResolvedValue(null);
  await expect(getMyEvents()).rejects.toThrow("LOGIN"); expect(db.event.findMany).not.toHaveBeenCalled();
});
it("limits the query to own event or venue staff assignments, never bookings or trainers", async () => {
  await getMyEvents();
  const query = db.event.findMany.mock.calls[0][0];
  expect(query.where).toEqual({ status: { in: ["PUBLISHED", "CANCELLED", "COMPLETED"] }, OR: [
    { staff: { some: { userId: "me" } } }, { venue: { staff: { some: { userId: "me" } } } },
  ] });
  expect(query.select.staff).toEqual({ where: { userId: "me" }, select: { id: true }, take: 1 });
  expect(query.select.venue).toEqual({ select: { name: true, staff: { where: { userId: "me" }, select: { id: true }, take: 1 } } });
  expect(query.select).not.toHaveProperty("bookings");
  expect(query.select).not.toHaveProperty("trainers");
});
it.each([
  [{ staff: [{ id: "private-staff" }] }, "Event-Staff"],
  [{ venue: { name: "Hall", staff: [{ id: "private-staff" }] } }, "Venue-Staff"],
])("shows staff role and ticket management for %j", async (relations, role) => {
  db.event.findMany.mockResolvedValue([{ ...event, ...relations }]);
  expect((await getMyEvents())[0].roles).toEqual([role]);
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain('href="/company/studio/events/event-1/tickets"');
  expect(html).not.toContain("private-staff");
  expect(html).not.toContain("Teilnehmer");
});
it("combines both staff roles in a single row", async () => {
  db.event.findMany.mockResolvedValue([{ ...event, staff: [{ id: "s" }], venue: { name: "Hall", staff: [{ id: "v" }] } }]);
  expect((await getMyEvents())[0].roles).toEqual(["Event-Staff", "Venue-Staff"]);
  const html = renderToStaticMarkup(await Page());
  expect(html.match(/<tr/g)).toHaveLength(2);
  expect(html).toContain('href="/events/studio/event-1"');
});
it("renders a staff-specific empty state and links personal bookings separately", async () => {
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain("Check-In Management");
  expect(html).toContain("als Event-Staff oder Venue-Staff zugeordnet");
  expect(html).toContain('href="/account/bookings"');
  expect(html).not.toContain("Ticketverwaltung");
});
it.each([
  ["PUBLISHED", "bg-green-100"], ["CANCELLED", "bg-red-100"], ["COMPLETED", "bg-zinc-200"],
])("keeps %s staff events visible with status and ticket action in separate cells", async (status, color) => {
  db.event.findMany.mockResolvedValue([{ ...event, status, staff: [{ id: "s" }] }]);
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain(color);
  const cells = html.match(/<td[\s\S]*?<\/td>/g)!;
  expect(cells[4]).toContain("Event-Staff"); expect(cells[4]).not.toContain("Ticketverwaltung");
  expect(cells[5]).toContain("Ticketverwaltung");
  if (status !== "PUBLISHED") expect(html).not.toContain('href="/events/studio/event-1"');
});
