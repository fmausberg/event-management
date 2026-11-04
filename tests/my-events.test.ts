import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getMyEvents } from "@/lib/account/events";
import Page from "@/app/account/eventmanagement/page";
import { buildNavigation } from "@/lib/navigation/model";
import { groupAssignedEvents } from "@/lib/account/events-presentation";
import LegacyEventsPage from "@/app/account/events/page";
import { redirect } from "next/navigation";

const { auth, db } = vi.hoisted(() => ({ auth: vi.fn(), db: { user: { findUnique: vi.fn() }, event: { findMany: vi.fn() } } }));
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("LOGIN"); }) }));
const event = { id: "event-1", name: "Yoga", beginsAt: new Date("2026-10-15T10:00:00Z"), endsAt: new Date("2026-10-15T11:00:00Z"), status: "PUBLISHED", company: { name: "Studio", slug: "studio" }, venue: null, staff: [], trainers: [] };
beforeEach(() => {
  vi.resetAllMocks(); auth.mockResolvedValue({ user: { id: "me" } });
  db.user.findUnique.mockResolvedValue({ id: "me", email: "ada@example.com" }); db.event.findMany.mockResolvedValue([]);
});
it("redirects the former account events route", () => {
  expect(LegacyEventsPage).toThrow("LOGIN");
  expect(redirect).toHaveBeenCalledWith("/account/eventmanagement");
});

it("keeps events current until their end, even with a past start or completed status", () => {
  const now = new Date("2026-11-02T10:00Z");
  const groups = groupAssignedEvents([
    { ...event, id: "ongoing", status: "COMPLETED", beginsAt: new Date("2026-11-02T09:00Z"), endsAt: new Date("2026-11-02T11:00Z") },
    { ...event, id: "no-end", beginsAt: new Date("2020-01-01T10:00Z"), endsAt: null },
    { ...event, id: "ended", beginsAt: new Date("2026-11-02T09:00Z"), endsAt: now },
  ], now);
  expect(groups.upcoming.map(row => row.id)).toEqual(["no-end", "ongoing"]);
  expect(groups.past.map(row => row.id)).toEqual(["ended"]);
});
it("renames the personal menu entry without requiring a company or admin role", () => {
  const navigation = buildNavigation({ name: "Ada", email: "ada@example.com", role: "USER", memberships: [] }, true);
  expect(navigation.groups[0].items).toContainEqual({ label: "Veranstaltungsverwaltung", href: "/account/eventmanagement", icon: "calendar-check" });
});
it("redirects guests and deleted accounts before querying events", async () => {
  auth.mockResolvedValue(null); await expect(getMyEvents()).rejects.toThrow("LOGIN");
  expect(db.user.findUnique).not.toHaveBeenCalled(); expect(db.event.findMany).not.toHaveBeenCalled();
  auth.mockResolvedValue({ user: { id: "deleted" } }); db.user.findUnique.mockResolvedValue(null);
  await expect(getMyEvents()).rejects.toThrow("LOGIN"); expect(db.event.findMany).not.toHaveBeenCalled();
});
it("limits the query to own staff or linked trainer assignments, never bookings", async () => {
  await getMyEvents();
  const query = db.event.findMany.mock.calls[0][0];
  expect(query.orderBy).toEqual([{ beginsAt: { sort: "asc", nulls: "last" } }, { id: "asc" }]);
  expect(query.where).toEqual({ status: { in: ["PUBLISHED", "CANCELLED", "COMPLETED"] }, OR: [
    { staff: { some: { userId: "me" } } }, { venue: { staff: { some: { userId: "me" } } } },
    { trainers: { some: { trainer: { OR: [{ userId: "me" }] } } } },
  ] });
  expect(query.select.staff).toEqual({ where: { userId: "me" }, select: { id: true }, take: 1 });
  expect(query.select.venue).toEqual({ select: { name: true, staff: { where: { userId: "me" }, select: { id: true }, take: 1 } } });
  expect(query.select).not.toHaveProperty("bookings");
  expect(query.select.trainers).toEqual({ where: { trainer: { OR: [{ userId: "me" }] } }, select: { id: true }, take: 1 });
});
it.each([
  [{ staff: [{ id: "private-staff" }] }, "Veranstaltungsteam"],
  [{ trainers: [{ id: "private-trainer" }] }, "Trainer"],
  [{ venue: { name: "Hall", staff: [{ id: "private-staff" }] } }, "Ortsteam"],
])("shows staff role and ticket management for %j", async (relations, role) => {
  db.event.findMany.mockResolvedValue([{ ...event, ...relations }]);
  expect((await getMyEvents())[0].roles).toEqual([role]);
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain('href="/company/studio/events/event-1/tickets"');
  expect(html).not.toContain("private-staff");
  expect(html).not.toContain("private-trainer");
  expect(html).toContain(role);
  expect(html).not.toContain("Teilnehmer");
});
it("combines staff and trainer roles in a single row", async () => {
  db.event.findMany.mockResolvedValue([{ ...event, staff: [{ id: "s" }], trainers: [{ id: "t" }], venue: { name: "Hall", staff: [{ id: "v" }] } }]);
  expect((await getMyEvents())[0].roles).toEqual(["Veranstaltungsteam", "Ortsteam", "Trainer"]);
  const html = renderToStaticMarkup(await Page());
  expect(html.match(/<tr/g)).toHaveLength(2);
  expect(html).toContain('href="/events/studio/event-1"');
});
it("renders a staff-specific empty state and links personal bookings separately", async () => {
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain("Veranstaltungsverwaltung");
  expect(html).toContain("als Veranstaltungsteam, Ortsteam oder Trainer zugeordnet");
  expect(html).toContain('href="/account/bookings"');
  expect(html).not.toContain("Ticketverwaltung");
});

it("groups ongoing and upcoming assignments in chronological order, with past events newest first", () => {
  const now = new Date("2026-11-02T10:00Z");
  const items = [
    { ...event, id: "later", beginsAt: new Date("2026-12-01T10:00Z"), endsAt: null },
    { ...event, id: "old", beginsAt: new Date("2026-09-01T10:00Z"), endsAt: new Date("2026-09-01T11:00Z") },
    { ...event, id: "unknown", beginsAt: null, endsAt: null },
    { ...event, id: "next", beginsAt: new Date("2026-11-03T10:00Z"), endsAt: null },
    { ...event, id: "ongoing", beginsAt: new Date("2026-11-02T09:00Z"), endsAt: new Date("2026-11-02T11:00Z") },
    { ...event, id: "recent", beginsAt: new Date("2026-11-01T10:00Z"), endsAt: new Date("2026-11-01T11:00Z") },
    { ...event, id: "completed", status: "COMPLETED", beginsAt: null, endsAt: null },
  ];
  const groups = groupAssignedEvents(items, now);
  expect(groups.upcoming.map(row => row.id)).toEqual(["ongoing", "next", "later", "completed", "unknown"]);
  expect(groups.past.map(row => row.id)).toEqual(["recent", "old"]);
  expect(items[0].id).toBe("later");
});

it("renders separate expandable lists with future events soonest first", async () => {
  db.event.findMany.mockResolvedValue([
    { ...event, id: "later", name: "Later event", beginsAt: new Date("2099-12-01T10:00Z"), endsAt: null },
    { ...event, id: "old", name: "Past event", beginsAt: new Date("2020-01-01T10:00Z"), endsAt: new Date("2020-01-01T11:00Z") },
    { ...event, id: "next", name: "Next event", beginsAt: new Date("2099-01-01T10:00Z"), endsAt: null },
  ]);
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain("Account / Veranstaltungsverwaltung");
  const upcoming = html.match(/<details[^>]*aria-label="Kommende Veranstaltungen"[\s\S]*?<\/details>/)![0];
  const past = html.match(/<details[^>]*aria-label="Vergangene Veranstaltungen"[\s\S]*?<\/details>/)![0];
  expect(upcoming).toContain('open=""');
  expect(upcoming.indexOf("Next event")).toBeLessThan(upcoming.indexOf("Later event"));
  expect(upcoming).not.toContain("Past event");
  expect(past).not.toContain('open=""');
  expect(past).toContain("Past event");
  expect(past).toContain('href="/company/studio/events/old/tickets"');
});
it.each([
  ["PUBLISHED", "bg-green-100"], ["CANCELLED", "bg-red-100"], ["COMPLETED", "bg-zinc-200"],
])("keeps %s staff events visible with status and ticket action in separate cells", async (status, color) => {
  db.event.findMany.mockResolvedValue([{ ...event, status, staff: [{ id: "s" }] }]);
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain(color);
  const cells = html.match(/<td[\s\S]*?<\/td>/g)!;
  expect(cells[4]).toContain("Veranstaltungsteam"); expect(cells[4]).not.toContain("Ticketverwaltung");
  expect(cells[5]).toContain("Ticketverwaltung");
  if (status !== "PUBLISHED") expect(html).not.toContain('href="/events/studio/event-1"');
});
