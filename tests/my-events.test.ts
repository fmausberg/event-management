import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getMyEvents } from "@/lib/account/events";
import Page from "@/app/account/events/page";
import { buildNavigation } from "@/lib/navigation/model";

const { auth, db } = vi.hoisted(() => ({ auth: vi.fn(), db: { user: { findUnique: vi.fn(), findMany: vi.fn() }, event: { findMany: vi.fn() } } }));
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("LOGIN"); } }));
const event = { id: "event-1", name: "Yoga", beginsAt: new Date("2026-10-15T10:00:00Z"), endsAt: new Date("2026-10-15T11:00:00Z"), status: "PUBLISHED", company: { name: "Studio", slug: "studio" }, venue: null, bookings: [], trainers: [], staff: [] };
beforeEach(() => {
  vi.resetAllMocks(); auth.mockResolvedValue({ user: { id: "me", email: "stale@example.com" } });
  db.user.findUnique.mockResolvedValue({ id: "me", email: "ada@example.com" }); db.event.findMany.mockResolvedValue([]);
  db.user.findMany.mockResolvedValue([{ id: "me" }]);
});
it("shows the personal menu entry without a company or admin role", () => {
  const navigation = buildNavigation({ name: "Ada", email: "ada@example.com", role: "USER", memberships: [] });
  expect(navigation.groups[0].items).toContainEqual({ label: "Meine Veranstaltungen", href: "/account/events", icon: "calendar-check" });
});
it("redirects guests and deleted accounts before querying events", async () => {
  auth.mockResolvedValue(null); await expect(getMyEvents()).rejects.toThrow("LOGIN");
  expect(db.user.findUnique).not.toHaveBeenCalled(); expect(db.event.findMany).not.toHaveBeenCalled();
  auth.mockResolvedValue({ user: { id: "deleted" } }); db.user.findUnique.mockResolvedValue(null);
  await expect(getMyEvents()).rejects.toThrow("LOGIN"); expect(db.event.findMany).not.toHaveBeenCalled();
});
it("scopes all four sources and returned relationships to the current database identity", async () => {
  await getMyEvents();
  const trainer = { OR: [{ userId: "me" }] };
  expect(db.event.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { status: { in: ["PUBLISHED", "CANCELLED", "COMPLETED"] }, OR: [{ bookings: { some: { userId: "me" } } }, { trainers: { some: { trainer } } }, { staff: { some: { userId: "me" } } }, { venue: { staff: { some: { userId: "me" } } } }] },
    select: expect.objectContaining({
      bookings: { where: { userId: "me" }, select: { status: true }, distinct: ["status"] },
      trainers: { where: { trainer }, select: { id: true }, take: 1 },
      staff: { where: { userId: "me" }, select: { id: true }, take: 1 },
      venue: { select: { name: true, staff: { where: { userId: "me" }, select: { id: true }, take: 1 } } },
    }),
  }));
});
it("does not match unlinked trainers when account emails are ambiguous", async () => {
  db.user.findMany.mockResolvedValue([{ id: "me" }, { id: "other" }]);
  await getMyEvents();
  expect(db.event.findMany.mock.calls[0][0].where.OR[1]).toEqual({ trainers: { some: { trainer: { OR: [{ userId: "me" }] } } } });
});
it.each([
  [{ bookings: [{ status: "CONFIRMED" }] }, "Teilnehmer"],
  [{ trainers: [{ id: "trainer" }] }, "Trainer"],
  [{ staff: [{ id: "staff" }] }, "Event-Staff"],
  [{ venue: { name: "Hall", staff: [{ id: "staff" }] } }, "Venue-Staff"],
])("includes the role from each source %j", async (relations, role) => {
  db.event.findMany.mockResolvedValue([{ ...event, ...relations }]);
  expect((await getMyEvents())[0].roles).toEqual([role]);
});
it("combines multiple roles in one event row without disclosing assignment IDs", async () => {
  db.event.findMany.mockResolvedValue([{ ...event, bookings: [{ status: "CONFIRMED" }, { status: "CANCELLED" }], trainers: [{ id: "private-trainer" }], staff: [{ id: "private-staff" }], venue: { name: "Hall", staff: [{ id: "private-venue-staff" }] } }]);
  const rows = await getMyEvents(); expect(rows).toHaveLength(1);
  expect(rows[0].roles).toEqual(["Teilnehmer", "Trainer", "Event-Staff", "Venue-Staff"]);
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain("Bestätigt, Storniert"); expect(html).toContain('href="/events/studio/event-1"');
  expect(html).not.toContain("private-"); expect(html.match(/<tr/g)).toHaveLength(2);
});
it("keeps cancelled events visible without a broken public link", async () => {
  db.event.findMany.mockResolvedValue([{ ...event, status: "CANCELLED", bookings: [{ status: "EXPIRED" }] }]);
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain("Abgesagt"); expect(html).toContain("Abgelaufen"); expect(html).toContain("Teilnehmer");
  expect(html).not.toContain('href="/events/studio/event-1"');
});
it("renders an empty state and a link to discover events", async () => {
  const html = renderToStaticMarkup(await Page()); expect(html).toContain("Hier erscheinen deine gebuchten"); expect(html).toContain('href="/events"');
});
it.each([
  { trainers: [{ id: "trainer" }] },
  { staff: [{ id: "staff" }] },
  { venue: { name: "Hall", staff: [{ id: "staff" }] } },
])("links assigned trainers and staff to their event ticket management %j", async (relations) => {
  db.event.findMany.mockResolvedValue([{ ...event, ...relations }]);
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain("Ticketverwaltung");
  expect(html).toContain('href="/company/studio/events/event-1/tickets"');
});
it("does not offer ticket management to participants alone", async () => {
  db.event.findMany.mockResolvedValue([{ ...event, bookings: [{ status: "CONFIRMED" }] }]);
  expect(renderToStaticMarkup(await Page())).not.toContain("Ticketverwaltung");
});

it.each([
 ["PUBLISHED", "bg-green-100"], ["CANCELLED", "bg-red-100"], ["COMPLETED", "bg-zinc-200"],
])("renders %s with a status tag and puts ticket management in its own cell", async (status, color) => {
 db.event.findMany.mockResolvedValue([{ ...event, status, trainers: [{ id: "trainer" }] }]);
 const html = renderToStaticMarkup(await Page());
 expect(html).toContain(color); expect(html).toContain("rounded-full");
 const cells = html.match(/<td[\s\S]*?<\/td>/g)!;
 expect(cells[4]).toContain("Trainer"); expect(cells[4]).not.toContain("Ticketverwaltung");
 expect(cells[5]).toContain("Ticketverwaltung");
});
