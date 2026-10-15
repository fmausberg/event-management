import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { saveEvent, deleteEvent } from "@/app/company/[companyKey]/events/actions";
import Page from "@/app/company/[companyKey]/events/page";
import { applySeries, emptyEvent, eventSchema } from "@/lib/company-events/model";
import type { SeriesRow } from "@/lib/event-series/validation";
import { uploadEventImage, deleteEventImage } from "@/lib/events/images";
vi.mock("@/lib/events/images", async (original) => ({ ...await original<typeof import("@/lib/events/images")>(), uploadEventImage: vi.fn(), deleteEventImage: vi.fn() }));
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
 vi.mocked(deleteEventImage).mockResolvedValue(true);
 vi.mocked(uploadEventImage).mockResolvedValue({ imageUrl: "https://res.cloudinary.com/test/image/upload/new.jpg", imagePublicId: "events_pictures/company-id/new" });
 db.company.findUnique.mockResolvedValue({ id: "company-id", slug: "yoga", name: "Yoga" });
 db.event.findFirst.mockResolvedValue({ status: "DRAFT" }); db.event.findMany.mockResolvedValue([]); db.eventSeries.findMany.mockResolvedValue([]); db.venue.findMany.mockResolvedValue([]);
 db.event.updateMany.mockResolvedValue({ count: 1 }); db.event.deleteMany.mockResolvedValue({ count: 1 });
});
function imageForm(overrides: Record<string, string> = {}) {
 const data = form(overrides); data.set("coverImage", new File([new Uint8Array([255, 216, 255])], "cover.jpg", { type: "image/jpeg" })); return data;
}
it.each(["COMPANY_USER", "COMPANY_ADMIN", "ADMIN"])("allows %s to create an event with a server-owned image", async (role) => {
 db.user.findUnique.mockResolvedValue({ role: role === "ADMIN" ? "ADMIN" : "USER" }); db.companyMembership.findUnique.mockResolvedValue({ role, status: "ACTIVE" });
 expect((await saveEvent("yoga", null, {}, imageForm({ imageUrl: "https://evil.example/image.jpg", imagePublicId: "foreign" }))).success).toBe(true);
 expect(uploadEventImage).toHaveBeenCalledWith("company-id", expect.any(File));
 expect(db.event.create).toHaveBeenCalledWith({ data: expect.objectContaining({ imagePublicId: "events_pictures/company-id/new", imageUrl: "https://res.cloudinary.com/test/image/upload/new.jpg" }) });
});
it("checks event ownership and membership before uploading", async () => {
 db.event.findFirst.mockResolvedValue(null);
 expect((await saveEvent("yoga", "foreign", {}, imageForm())).success).toBeUndefined(); expect(uploadEventImage).not.toHaveBeenCalled();
 db.user.findUnique.mockResolvedValue({ role: "USER" }); db.companyMembership.findUnique.mockResolvedValue(null);
 expect((await saveEvent("yoga", null, {}, imageForm())).success).toBeUndefined(); expect(uploadEventImage).not.toHaveBeenCalled();
});
it("replaces the image while retaining the old Cloudinary asset", async () => {
 db.event.findFirst.mockResolvedValue({ status: "DRAFT", imagePublicId: "events_pictures/company-id/old" });
 expect((await saveEvent("yoga", "event-1", {}, imageForm())).success).toBe(true);
 expect(deleteEventImage).not.toHaveBeenCalled();
});
it("rolls back the uploaded image if the event write fails, preserving the old image", async () => {
 db.event.findFirst.mockResolvedValue({ status: "DRAFT", imagePublicId: "old" }); db.$transaction.mockRejectedValue(new Error("failed write"));
 expect((await saveEvent("yoga", "event-1", {}, imageForm())).success).toBeUndefined();
 expect(deleteEventImage).toHaveBeenCalledWith("events_pictures/company-id/new"); expect(deleteEventImage).not.toHaveBeenCalledWith("old");
});
it("removes only the stored reference and ignores forged IDs", async () => {
 db.event.findFirst.mockResolvedValue({ status: "DRAFT", imagePublicId: "old" });
 vi.mocked(deleteEventImage).mockResolvedValue(false);
 const result = await saveEvent("yoga", "event-1", {}, form({ removeImage: "yes", imagePublicId: "foreign" }));
 expect(result.success).toBe(true);
 expect(db.event.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ imageUrl: null, imagePublicId: null }) }));
 expect(deleteEventImage).not.toHaveBeenCalled(); expect(uploadEventImage).not.toHaveBeenCalled();
});
it("does not replace an image on an ordinary save or upload one while cancelling", async () => {
 await saveEvent("yoga", "event-1", {}, form({ imagePublicId: "foreign", imageUrl: "foreign" }));
 expect(db.event.updateMany.mock.calls[0][0].data).not.toHaveProperty("imageUrl");
 await saveEvent("yoga", "event-1", {}, imageForm({ intent: "cancel" }));
 expect(uploadEventImage).not.toHaveBeenCalled();
});
it("retains Cloudinary images when deleting an event", async () => {
 db.event.findFirst.mockResolvedValue({ imagePublicId: "old" });
 await deleteEvent("yoga", "event-1", {}, form({ confirmed: "yes" })); expect(deleteEventImage).not.toHaveBeenCalled();
 vi.mocked(deleteEventImage).mockClear(); db.event.deleteMany.mockResolvedValue({ count: 0 });
 await deleteEvent("yoga", "event-1", {}, form({ confirmed: "yes" })); expect(deleteEventImage).not.toHaveBeenCalled();
});
it("creates with trusted company and creator and converts dates and prices", async () => {
 expect((await saveEvent("yoga", null, {}, form({ companyId: "foreign", createdById: "foreign" }))).success).toBe(true);
 expect(db.event.create).toHaveBeenCalledWith({ data: expect.objectContaining({ companyId: "company-id", createdById: "actor", ticketPrice: "12.50", maxSeats: 20, beginsAt: new Date("2026-10-14T08:00:00Z") }) });
});
it("uses the button intent rather than a forged status when creating", async () => {
 db.venue.findFirst.mockResolvedValue({ id: "venue-1" });
 await saveEvent("yoga", null, {}, form({ intent: "draft", status: "COMPLETED" }));
 expect(db.event.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ status: "DRAFT" }) });
 await saveEvent("yoga", null, {}, form({ intent: "publish", shortdescription: "Kurz", venueId: "venue-1", confirmMissingOptional: "yes", beginsAt: "2099-01-01T10:00:00Z", endsAt: "2099-01-01T11:00:00Z" }));
 expect(db.event.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ status: "PUBLISHED" }) });
});
it("rejects publishing events whose end is in the past", async () => {
 db.venue.findFirst.mockResolvedValue({ id: "venue-1" });
 expect((await saveEvent("yoga", null, {}, form({ intent: "publish", shortdescription: "Kurz", venueId: "venue-1", confirmMissingOptional: "yes", beginsAt: "2000-01-01T10:00:00Z", endsAt: "2000-01-01T11:00:00Z" }))).errors?.endsAt).toBeDefined();
 expect(db.event.create).not.toHaveBeenCalled();
});
it("publishes drafts but cannot revive completed or cancelled events", async () => {
 db.venue.findFirst.mockResolvedValue({ id: "venue-1" });
 const publish = form({ intent: "publish", shortdescription: "Kurz", venueId: "venue-1", confirmMissingOptional: "yes", beginsAt: "2099-01-01T10:00:00Z", endsAt: "2099-01-01T11:00:00Z" });
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
 expect(applySeries(values, series)).toEqual({ ...values, eventSeriesId: "series-1", name: "Series", shortdescription: "Short", description: "Long", trainerIds: ["trainer-1"], venueId: "venue-1", maxSeats: "25", ticketPrice: "19.50", currency: "EUR" });
 const next = applySeries(values, { ...series, suggestedMaxSeats: null, suggestedTicketPrice: null, suggestedTrainerName: null, suggestedTrainerId: null, suggestedVenueId: null });
 expect(next).toMatchObject({ maxSeats: "", ticketPrice: "", trainerIds: [], venueId: "" });
});

it("copies the trusted series image at creation, without changing it on ordinary edits", async () => {
 db.eventSeries.findFirst.mockResolvedValue({ id: "series-1", imageUrl: "https://example.com/series.jpg" });
 await saveEvent("yoga", null, {}, form({ eventSeriesId: "series-1", imageUrl: "https://evil.example/" }));
 expect(db.event.create).toHaveBeenCalledWith({ data: expect.objectContaining({ imageUrl: "https://example.com/series.jpg" }) });
 await saveEvent("yoga", "event-1", {}, form({ eventSeriesId: "series-1" }));
 expect(db.event.updateMany.mock.calls[0][0].data).not.toHaveProperty("imageUrl");
});
it("lets a new upload or explicit removal override the series image", async () => {
 db.eventSeries.findFirst.mockResolvedValue({ id: "series-1", imageUrl: "https://example.com/series.jpg" });
 await saveEvent("yoga", null, {}, imageForm({ eventSeriesId: "series-1" }));
 expect(db.event.create.mock.calls[0][0].data.imageUrl).toContain("new.jpg");
 await saveEvent("yoga", null, {}, form({ eventSeriesId: "series-1", removeImage: "yes" }));
 expect(db.event.create.mock.calls[1][0].data.imageUrl).toBeNull();
});

it("stores EUR when currency is omitted or manipulated", async () => {
 const missing = form(); missing.delete("currency");
 expect((await saveEvent("yoga", null, {}, missing)).success).toBe(true);
 expect(db.event.create.mock.calls[0][0].data.currency).toBe("EUR");
 await saveEvent("yoga", "existing", {}, form({ currency: "USD" }));
 expect(db.event.updateMany.mock.calls[0][0].data.currency).toBe("EUR");
});

it("saves a completely empty draft using null for unknown dates, price and capacity", async () => {
 const data = new FormData(); data.set("intent", "draft");
 expect((await saveEvent("yoga", null, {}, data)).success).toBe(true);
 expect(db.event.create).toHaveBeenCalledWith({ data: expect.objectContaining({ name: "", shortdescription: null, beginsAt: null, endsAt: null, maxSeats: null, ticketPrice: null, venueId: null, status: "DRAFT" }) });
});
it.each(["name", "shortdescription", "beginsAt", "endsAt", "ticketPrice", "maxSeats", "venueId"])("requires %s when publishing even with optional warnings acknowledged", async (key) => {
 const data = form({ intent: "publish", shortdescription: "Kurz", venueId: "venue-1", beginsAt: "2099-01-01T10:00:00Z", endsAt: "2099-01-01T11:00:00Z", confirmMissingOptional: "yes", [key]: "" });
 const result = await saveEvent("yoga", null, {}, data);
 expect(result.errors?.[key as keyof typeof values]).toBeDefined();
 expect(db.event.create).not.toHaveBeenCalled(); expect(uploadEventImage).not.toHaveBeenCalled();
});
it("requires confirmation for missing optional fields without uploading or saving first", async () => {
 db.venue.findFirst.mockResolvedValue({ id: "venue-1" });
 const data = form({ intent: "publish", shortdescription: "Kurz", venueId: "venue-1", beginsAt: "2099-01-01T10:00:00Z", endsAt: "2099-01-01T11:00:00Z", ticketPrice: "0" });
 expect((await saveEvent("yoga", null, {}, data)).warnings).toEqual(["Titelbild", "Trainer", "Beschreibung"]);
 expect(db.event.create).not.toHaveBeenCalled();
 data.set("confirmMissingOptional", "yes");
 expect((await saveEvent("yoga", null, {}, data)).success).toBe(true);
 expect(db.event.create.mock.calls[0][0].data.ticketPrice).toBe("0");
});
it("does not warn when a series cover, trainers and description are present", async () => {
 db.venue.findFirst.mockResolvedValue({ id: "venue-1" });
 db.eventSeries.findFirst.mockResolvedValue({ id: "series-1", imageUrl: "https://example.com/cover.jpg" });
 db.trainer.findMany.mockResolvedValue([{ id: "trainer-1" }]);
 const data = form({ intent: "publish", shortdescription: "Kurz", description: "Beschreibung", venueId: "venue-1", eventSeriesId: "series-1", beginsAt: "2099-01-01T10:00:00Z", endsAt: "2099-01-01T11:00:00Z" }); data.append("trainerIds", "trainer-1");
 expect((await saveEvent("yoga", null, {}, data)).success).toBe(true);
});
it("prevents clearing mandatory fields on a published event via save", async () => {
 db.event.findFirst.mockResolvedValue({ status: "PUBLISHED" });
 expect((await saveEvent("yoga", "event-1", {}, form({ intent: "save", beginsAt: "" }))).errors?.beginsAt).toBeDefined();
 expect(db.event.updateMany).not.toHaveBeenCalled();
});
it("renders incomplete drafts without inventing dates or free ticket prices", async () => {
 db.event.findMany.mockResolvedValue([{ id: "event-1", number: 1, name: "", status: "DRAFT", beginsAt: null, endsAt: null, maxSeats: null, ticketPrice: null, trainers: [], currency: "EUR", _count: { bookings: 0, platformEvents: 0 } }]);
 db.booking.groupBy.mockResolvedValue([]);
 const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ companyKey: "yoga" }) }));
 expect(html).toContain("Unbenannter Entwurf"); expect(html).toContain("Noch offen"); expect(html).not.toContain("NaN");
});
