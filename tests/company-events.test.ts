import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { saveEvent, deleteEvent } from "@/app/company/[companyKey]/events/actions";
import Page from "@/app/company/[companyKey]/events/page";
import { applySeries, emptyEvent, eventSchema } from "@/lib/company-events/model";
import type { SeriesRow } from "@/lib/event-series/validation";
const { auth, db } = vi.hoisted(() => ({ auth: vi.fn(), db: {
 trainer: { findMany: vi.fn(), findFirst: vi.fn() },
 booking: { groupBy: vi.fn() },
 user: { findUnique: vi.fn() }, company: { findUnique: vi.fn() }, companyMembership: { findUnique: vi.fn() },
 $transaction: vi.fn(), eventTrainer: { deleteMany: vi.fn(), createMany: vi.fn() },
 event: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
 eventSeries: { findMany: vi.fn(), findFirst: vi.fn() }, venue: { findMany: vi.fn(), findFirst: vi.fn() },
} }));
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("LOGIN"); }, notFound: () => { throw new Error("NOT_FOUND"); } }));
const values = { ...emptyEvent, name: "Yoga", beginsAt: "2026-10-14T10:00:00+02:00", endsAt: "2026-10-14T11:00:00+02:00", maxSeats: "20", ticketPrice: "12,50" };
function form(overrides: Record<string, string> = {}) { const data = new FormData(); Object.entries({ ...values, ...overrides }).forEach(([key, value]) => Array.isArray(value) ? value.forEach((id) => data.append(key, id)) : data.set(key, value)); return data; }
beforeEach(() => {
 vi.resetAllMocks(); db.$transaction.mockImplementation((fn) => fn(db)); db.trainer.findMany.mockResolvedValue([]); auth.mockResolvedValue({ user: { id: "actor" } }); db.user.findUnique.mockResolvedValue({ role: "ADMIN" });
 db.company.findUnique.mockResolvedValue({ id: "company-id", slug: "yoga", name: "Yoga" });
 db.event.findFirst.mockResolvedValue({ status: "DRAFT" }); db.event.findMany.mockResolvedValue([]); db.eventSeries.findMany.mockResolvedValue([]); db.venue.findMany.mockResolvedValue([]);
 db.event.updateMany.mockResolvedValue({ count: 1 }); db.event.deleteMany.mockResolvedValue({ count: 1 });
});
it("creates with trusted company and creator and converts dates and prices", async () => {
 expect((await saveEvent("yoga", null, {}, form({ companyId: "foreign", createdById: "foreign" }))).success).toBe(true);
 expect(db.event.create).toHaveBeenCalledWith({ data: expect.objectContaining({ companyId: "company-id", createdById: "actor", ticketPrice: "12.50", maxSeats: 20, beginsAt: new Date("2026-10-14T08:00:00Z") }) });
});
it("uses the button intent rather than a forged status when creating", async () => {
 await saveEvent("yoga", null, {}, form({ intent: "draft", status: "COMPLETED" }));
 expect(db.event.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ status: "DRAFT" }) });
 await saveEvent("yoga", null, {}, form({ intent: "publish", beginsAt: "2099-01-01T10:00:00Z", endsAt: "2099-01-01T11:00:00Z" }));
 expect(db.event.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ status: "PUBLISHED" }) });
});
it("rejects publishing events whose end is in the past", async () => {
 expect((await saveEvent("yoga", null, {}, form({ intent: "publish", beginsAt: "2000-01-01T10:00:00Z", endsAt: "2000-01-01T11:00:00Z" }))).errors?.endsAt).toBeDefined();
 expect(db.event.create).not.toHaveBeenCalled();
});
it("publishes drafts but cannot revive completed or cancelled events", async () => {
 const publish = form({ intent: "publish", beginsAt: "2099-01-01T10:00:00Z", endsAt: "2099-01-01T11:00:00Z" });
 expect((await saveEvent("yoga", "event-1", {}, publish)).success).toBe(true);
 expect(db.event.updateMany).toHaveBeenLastCalledWith({ where: { id: "event-1", companyId: "company-id", status: "DRAFT" }, data: expect.objectContaining({ status: "PUBLISHED" }) });
 for (const status of ["COMPLETED", "CANCELLED", "PUBLISHED"]) {
  db.event.updateMany.mockClear(); db.event.findFirst.mockResolvedValue({ status });
  expect((await saveEvent("yoga", "event-1", {}, publish)).success).toBeUndefined(); expect(db.event.updateMany).not.toHaveBeenCalled();
 }
});
it("preserves the current database status when saving a stale form", async () => {
 db.event.findFirst.mockResolvedValue({ status: "COMPLETED" });
 await saveEvent("yoga", "event-1", {}, form({ intent: "save", status: "PUBLISHED" }));
 expect(db.event.updateMany).toHaveBeenCalledWith({ where: { id: "event-1", companyId: "company-id", status: "COMPLETED" }, data: expect.objectContaining({ status: "COMPLETED" }) });
});
it("cancels only a published unended event in the authorized company without saving form edits", async () => {
 const data = new FormData(); data.set("intent", "cancel");
 expect((await saveEvent("yoga", "event-1", {}, data)).success).toBe(true);
 expect(db.event.updateMany).toHaveBeenCalledWith({ where: { id: "event-1", companyId: "company-id", status: "PUBLISHED", endsAt: { gt: expect.any(Date) } }, data: { status: "CANCELLED" } });
 expect(db.eventTrainer.deleteMany).not.toHaveBeenCalled();
 db.event.updateMany.mockResolvedValue({ count: 0 });
 expect((await saveEvent("yoga", "event-1", {}, data)).success).toBeUndefined();
 db.event.updateMany.mockClear(); auth.mockResolvedValue(null);
 expect((await saveEvent("yoga", "event-1", {}, data)).success).toBeUndefined(); expect(db.event.updateMany).not.toHaveBeenCalled();
});
it("rejects foreign trainers before writing an event", async () => {
 const data = form(); data.append("trainerIds", "foreign");
 expect((await saveEvent("yoga", null, {}, data)).errors?.trainerIds).toBeDefined();
 expect(db.trainer.findMany).toHaveBeenCalledWith({ where: { id: { in: ["foreign"] }, companyId: "company-id" }, select: { id: true } });
 expect(db.event.create).not.toHaveBeenCalled();
});
it("creates relations, deduplicates IDs and ignores free text", async () => {
 db.trainer.findMany.mockResolvedValue([{ id: "trainer-1" }]);
 const data = form({ trainerName: "Untrusted name" }); data.append("trainerIds", "trainer-1"); data.append("trainerIds", "trainer-1");
 expect((await saveEvent("yoga", null, {}, data)).success).toBe(true);
 expect(db.event.create).toHaveBeenCalledWith({ data: expect.objectContaining({ trainerName: null, trainers: { create: [{ trainerId: "trainer-1" }] } }) });
});
it("updates assignments transactionally and can clear all trainers", async () => {
 db.trainer.findMany.mockResolvedValue([{ id: "trainer-1" }]);
 const data = form(); data.append("trainerIds", "trainer-1");
 expect((await saveEvent("yoga", "event-1", {}, data)).success).toBe(true);
 expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
 expect(db.eventTrainer.createMany).toHaveBeenCalledWith({ data: [{ eventId: "event-1", trainerId: "trainer-1" }], skipDuplicates: true });
 db.trainer.findMany.mockResolvedValue([]);
 expect((await saveEvent("yoga", "event-1", {}, form())).success).toBe(true);
 expect(db.eventTrainer.deleteMany).toHaveBeenLastCalledWith({ where: { eventId: "event-1", trainerId: { notIn: [] } } });
});
it("does not change assignments for a foreign event or report transaction failures as success", async () => {
 db.event.updateMany.mockResolvedValue({ count: 0 });
 expect((await saveEvent("yoga", "foreign", {}, form())).success).toBeUndefined();
 expect(db.eventTrainer.deleteMany).not.toHaveBeenCalled();
 db.$transaction.mockRejectedValue(new Error("rollback"));
 expect((await saveEvent("yoga", "event-1", {}, form())).success).toBeUndefined();
});
it("scopes updates and protected deletes to the company", async () => {
 await saveEvent("yoga", "event-1", {}, form());
 expect(db.event.updateMany).toHaveBeenCalledWith({ where: { id: "event-1", companyId: "company-id", status: "DRAFT" }, data: expect.any(Object) });
 await deleteEvent("yoga", "event-1", {}, form({ confirmed: "yes" }));
 expect(db.event.deleteMany).toHaveBeenCalledWith({ where: { id: "event-1", companyId: "company-id", bookings: { none: {} }, platformEvents: { none: {} } } });
});
it.each(["COMPANY_USER", "COMPANY_ADMIN"])("allows active %s", async (role) => {
 db.user.findUnique.mockResolvedValue({ role: "USER" }); db.companyMembership.findUnique.mockResolvedValue({ role, status: "ACTIVE" });
 expect((await saveEvent("yoga", null, {}, form())).success).toBe(true);
});
it.each([null, { role: "COMPANY_ADMIN", status: "SUSPENDED" }, { role: "COMPANY_ADMIN", status: "INVITED" }])("denies insufficient membership %j", async (membership) => {
 db.user.findUnique.mockResolvedValue({ role: "USER" }); db.companyMembership.findUnique.mockResolvedValue(membership);
 await expect(Page({ params: Promise.resolve({ companyKey: "yoga" }) })).rejects.toThrow("NOT_FOUND");
 expect((await saveEvent("yoga", null, {}, form())).success).toBeUndefined();
 expect((await deleteEvent("yoga", "event-1", {}, form({ confirmed: "yes" }))).success).toBeUndefined();
 expect(db.event.create).not.toHaveBeenCalled(); expect(db.event.deleteMany).not.toHaveBeenCalled(); expect(db.event.findMany).not.toHaveBeenCalled();
});
it.each(["venueId", "eventSeriesId"])("rejects cross-company %s", async (field) => {
 expect((await saveEvent("yoga", null, {}, form({ [field]: "foreign" }))).success).toBeUndefined();
 expect(db.event.create).not.toHaveBeenCalled();
});
it("accepts same-company selections and preserves event overrides", async () => {
 db.venue.findFirst.mockResolvedValue({ id: "venue-1" }); db.eventSeries.findFirst.mockResolvedValue({ id: "series-1" });
 expect((await saveEvent("yoga", null, {}, form({ venueId: "venue-1", eventSeriesId: "series-1", name: "Individual name" }))).success).toBe(true);
 expect(db.event.create).toHaveBeenCalledWith({ data: expect.objectContaining({ name: "Individual name", eventSeriesId: "series-1", venueId: "venue-1" }) });
});
it("rejects missing confirmation, linked events and foreign events", async () => {
 expect((await deleteEvent("yoga", "event-1", {}, form())).success).toBeUndefined();
 expect(db.event.deleteMany).not.toHaveBeenCalled();
 db.event.deleteMany.mockResolvedValue({ count: 0 }); db.event.updateMany.mockResolvedValue({ count: 0 });
 expect((await deleteEvent("yoga", "event-1", {}, form({ confirmed: "yes" }))).success).toBeUndefined();
 expect((await saveEvent("yoga", "event-1", {}, form())).success).toBeUndefined();
});
it.each([{ maxSeats: "1.5" }, { maxSeats: "0" }, { ticketPrice: "-2" }, { ticketPrice: "1.234" }, { beginsAt: "invalid" }, { endsAt: "2026-10-14T07:00:00Z" }, { status: "OTHER" }])("validates inputs %j", (invalid) => { expect(eventSchema.safeParse({ ...values, ...invalid }).success).toBe(false); });
it("renders empty table and create option, and redirects guests", async () => {
 const props = { params: Promise.resolve({ companyKey: "yoga" }) };
 const html = renderToStaticMarkup(await Page(props));
 expect(html).toContain("Noch keine Events vorhanden"); expect(html).toContain("+ Event erstellen");
 auth.mockResolvedValue(null); await expect(Page(props)).rejects.toThrow("LOGIN");
 expect((await saveEvent("yoga", null, {}, form())).success).toBeUndefined();
});
it.each([ [7, "13 / 20"], [25, "0 / 20"] ])("shows free/total seats from booking quantities (%i) as a ticket link", async (reserved, label) => {
 db.event.findMany.mockResolvedValue([{ ...values, id: "event-1", number: 1, maxSeats: 20, beginsAt: new Date(values.beginsAt), endsAt: new Date(values.endsAt), ticketPrice: { toFixed: () => "12.50" }, trainers: [], _count: { bookings: 2, platformEvents: 0 } }]);
 db.booking.groupBy.mockResolvedValue([{ eventId: "event-1", _sum: { quantity: reserved } }]);
 const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ companyKey: "yoga" }) }));
 expect(html).toContain("(freie) Plätze"); expect(html).toContain(`${label}</a>`);
 expect(html).toContain('href="/company/yoga/events/event-1/tickets"'); expect(html).not.toContain('>Tickets</a>');
 expect(db.booking.groupBy).toHaveBeenCalledWith({ by: ["eventId"], where: { eventId: { in: ["event-1"] }, status: { in: ["CONFIRMED", "PENDING_PAYMENT"] } }, _sum: { quantity: true } });
});
it("prefills all supported series fields, preserving schedule and status", () => {
 const series: SeriesRow = { id: "series-1", number: 1, name: "Series", shortdescription: "Short", description: "Long", imageUrl: null, suggestedMaxSeats: 25, suggestedTicketPrice: "19.50", suggestedCurrency: "USD", suggestedTrainerName: "Ada", suggestedTrainerId: "trainer-1", suggestedVenueId: "venue-1", _count: { events: 0 } };
 expect(applySeries(values, series)).toEqual({ ...values, eventSeriesId: "series-1", name: "Series", shortdescription: "Short", description: "Long", trainerIds: ["trainer-1"], venueId: "venue-1", maxSeats: "25", ticketPrice: "19.50", currency: "USD" });
 const next = applySeries(values, { ...series, suggestedMaxSeats: null, suggestedTicketPrice: null, suggestedTrainerName: null, suggestedTrainerId: null, suggestedVenueId: null });
 expect(next).toMatchObject({ maxSeats: "", ticketPrice: "", trainerIds: [], venueId: "" });
});
