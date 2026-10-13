import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { saveEvent, deleteEvent } from "@/app/company/[companyKey]/events/actions";
import Page from "@/app/company/[companyKey]/events/page";
import { applySeries, emptyEvent, eventSchema } from "@/lib/company-events/model";
import type { SeriesRow } from "@/lib/event-series/validation";
const { auth, db } = vi.hoisted(() => ({ auth: vi.fn(), db: {
 user: { findUnique: vi.fn() }, company: { findUnique: vi.fn() }, companyMembership: { findUnique: vi.fn() },
 event: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
 eventSeries: { findMany: vi.fn(), findFirst: vi.fn() }, venue: { findMany: vi.fn(), findFirst: vi.fn() },
} }));
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("LOGIN"); }, notFound: () => { throw new Error("NOT_FOUND"); } }));
const values = { ...emptyEvent, name: "Yoga", beginsAt: "2026-10-14T10:00:00+02:00", endsAt: "2026-10-14T11:00:00+02:00", maxSeats: "20", ticketPrice: "12,50" };
function form(overrides: Record<string, string> = {}) { const data = new FormData(); Object.entries({ ...values, ...overrides }).forEach(([key, value]) => data.set(key, value)); return data; }
beforeEach(() => {
 vi.resetAllMocks(); auth.mockResolvedValue({ user: { id: "actor" } }); db.user.findUnique.mockResolvedValue({ role: "ADMIN" });
 db.company.findUnique.mockResolvedValue({ id: "company-id", slug: "yoga", name: "Yoga" });
 db.event.findMany.mockResolvedValue([]); db.eventSeries.findMany.mockResolvedValue([]); db.venue.findMany.mockResolvedValue([]);
 db.event.updateMany.mockResolvedValue({ count: 1 }); db.event.deleteMany.mockResolvedValue({ count: 1 });
});
it("creates with trusted company and creator and converts dates and prices", async () => {
 expect((await saveEvent("yoga", null, {}, form({ companyId: "foreign", createdById: "foreign" }))).success).toBe(true);
 expect(db.event.create).toHaveBeenCalledWith({ data: expect.objectContaining({ companyId: "company-id", createdById: "actor", ticketPrice: "12.50", maxSeats: 20, beginsAt: new Date("2026-10-14T08:00:00Z") }) });
});
it("scopes updates and protected deletes to the company", async () => {
 await saveEvent("yoga", "event-1", {}, form());
 expect(db.event.updateMany).toHaveBeenCalledWith({ where: { id: "event-1", companyId: "company-id" }, data: expect.any(Object) });
 await deleteEvent("yoga", "event-1", {}, form({ confirmed: "yes" }));
 expect(db.event.deleteMany).toHaveBeenCalledWith({ where: { id: "event-1", companyId: "company-id", bookings: { none: {} }, platformEvents: { none: {} } } });
});
it("allows active company admins", async () => {
 db.user.findUnique.mockResolvedValue({ role: "USER" }); db.companyMembership.findUnique.mockResolvedValue({ role: "COMPANY_ADMIN", status: "ACTIVE" });
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
it("prefills all supported series fields, preserving schedule and status", () => {
 const series: SeriesRow = { id: "series-1", number: 1, name: "Series", shortdescription: "Short", description: "Long", imageUrl: null, suggestedMaxSeats: 25, suggestedTicketPrice: "19.50", suggestedCurrency: "USD", suggestedTrainerName: "Ada", suggestedVenueId: "venue-1", _count: { events: 0 } };
 expect(applySeries(values, series)).toEqual({ ...values, eventSeriesId: "series-1", name: "Series", shortdescription: "Short", description: "Long", trainerName: "Ada", venueId: "venue-1", maxSeats: "25", ticketPrice: "19.50", currency: "USD" });
 const next = applySeries(values, { ...series, suggestedMaxSeats: null, suggestedTicketPrice: null, suggestedTrainerName: null, suggestedVenueId: null });
 expect(next).toMatchObject({ maxSeats: "", ticketPrice: "", trainerName: "", venueId: "" });
});
