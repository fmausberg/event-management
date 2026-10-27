import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { saveSeries, deleteSeries } from "@/app/company/[companyKey]/event-series/actions";
import Page from "@/app/company/[companyKey]/event-series/page";
import { getCompanySeries } from "@/lib/event-series/data";
import { seriesSchema } from "@/lib/event-series/validation";
import { uploadEventImage, deleteEventImage } from "@/lib/events/images";
vi.mock("@/lib/events/images", async (original) => ({ ...await original<typeof import("@/lib/events/images")>(), uploadEventImage: vi.fn(), deleteEventImage: vi.fn() }));
const { auth, db } = vi.hoisted(() => ({ auth: vi.fn(), db: {
 trainer: { findMany: vi.fn(), findFirst: vi.fn() },
 user: { findUnique: vi.fn() }, company: { findUnique: vi.fn() }, companyMembership: { findUnique: vi.fn() },
 eventSeries: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() }, venue: { findMany: vi.fn(), findFirst: vi.fn() },
} }));
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("LOGIN"); }, notFound: () => { throw new Error("NOT_FOUND"); } }));
const values = { name: " Yoga ", shortdescription: "", description: "", imageUrl: "", suggestedDuration: "", suggestedMaxSeats: "", suggestedTicketPrice: "12,50", suggestedCurrency: "eur", suggestedTrainerId: "", suggestedVenueId: "" };
function form(overrides: Record<string,string> = {}) { const data = new FormData(); Object.entries({ ...values, ...overrides }).forEach(([key,value]) => data.set(key,value)); return data; }
it.each(["0", "-1", "1.5", "abc", "2147483648"])("rejects invalid duration %s", (suggestedDuration) => {
 expect(seriesSchema.safeParse({ ...values, suggestedDuration }).success).toBe(false);
});
it("saves duration as integer minutes and allows clearing it", async () => {
 expect((await saveSeries("yoga", null, {}, form({ suggestedDuration: "90" }))).success).toBe(true);
 expect(db.eventSeries.create).toHaveBeenCalledWith({ data: expect.objectContaining({ suggestedDuration: 90 }) });
 await saveSeries("yoga", "series-1", {}, form({ suggestedDuration: "" }));
 expect(db.eventSeries.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ suggestedDuration: null }) }));
});
it("saves and clears the optional cancellation policy without touching events", async () => {
 await saveSeries("yoga", "series-1", {}, form({ suggestedFreeCancellationUntilMinutesBeforeStart: "1440" }));
 expect(db.eventSeries.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ suggestedFreeCancellationUntilMinutesBeforeStart: 1440 }) }));
 await saveSeries("yoga", "series-1", {}, form({ suggestedFreeCancellationUntilMinutesBeforeStart: "" }));
 expect(db.eventSeries.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ suggestedFreeCancellationUntilMinutesBeforeStart: null }) }));
});
beforeEach(() => {
 vi.resetAllMocks(); db.trainer.findMany.mockResolvedValue([]); auth.mockResolvedValue({ user: { id: "actor" } }); db.user.findUnique.mockResolvedValue({ role: "ADMIN" });
 db.company.findUnique.mockResolvedValue({ id: "company-id", slug: "yoga", name: "Yoga" });
 db.eventSeries.findMany.mockResolvedValue([]); db.venue.findMany.mockResolvedValue([]);
 db.eventSeries.updateMany.mockResolvedValue({ count: 1 }); db.eventSeries.deleteMany.mockResolvedValue({ count: 1 });
});
it("creates with trusted company and creator, normalizing price and currency", async () => {
 expect((await saveSeries("yoga", null, {}, form({ companyId: "foreign", createdById: "foreign" }))).success).toBe(true);
 expect(db.eventSeries.create).toHaveBeenCalledWith({ data: expect.objectContaining({ name: "Yoga", companyId: "company-id", createdById: "actor", suggestedTicketPrice: "12.50", suggestedCurrency: "EUR", suggestedMaxSeats: null }) });
});
it("scopes updates and deletes to company and preserves events", async () => {
 await saveSeries("yoga", "series-1", {}, form());
 expect(db.eventSeries.updateMany).toHaveBeenCalledWith({ where: { id: "series-1", companyId: "company-id" }, data: expect.any(Object) });
 await deleteSeries("yoga", "series-1", {}, form({ confirmed: "yes" }));
 expect(db.eventSeries.deleteMany).toHaveBeenCalledWith({ where: { id: "series-1", companyId: "company-id", events: { none: {} } } });
});
it.each(["COMPANY_USER", "COMPANY_ADMIN"])("allows active %s", async (role) => {
 db.user.findUnique.mockResolvedValue({ role: "USER" }); db.companyMembership.findUnique.mockResolvedValue({ role, status: "ACTIVE" });
 expect((await saveSeries("yoga", null, {}, form())).success).toBe(true);
});
it.each([null, { role: "COMPANY_ADMIN", status: "SUSPENDED" }, { role: "COMPANY_ADMIN", status: "INVITED" }])("denies insufficient membership %j", async (membership) => {
 db.user.findUnique.mockResolvedValue({ role: "USER" }); db.companyMembership.findUnique.mockResolvedValue(membership);
 await expect(getCompanySeries("yoga")).rejects.toThrow();
 expect((await saveSeries("yoga", null, {}, form())).success).toBeUndefined();
 expect((await deleteSeries("yoga", "series-1", {}, form({ confirmed: "yes" }))).success).toBeUndefined();
 expect(db.eventSeries.create).not.toHaveBeenCalled(); expect(db.eventSeries.deleteMany).not.toHaveBeenCalled();
});
it("rejects foreign venues", async () => {
 db.venue.findFirst.mockResolvedValue(null);
 expect((await saveSeries("yoga", null, {}, form({ suggestedVenueId: "foreign" }))).errors?.suggestedVenueId).toBeDefined();
 expect(db.eventSeries.create).not.toHaveBeenCalled();
});
it("rejects foreign trainers and saves a same-company trainer as the default", async () => {
 expect((await saveSeries("yoga", null, {}, form({ suggestedTrainerId: "foreign" }))).errors?.suggestedTrainerId).toBeDefined();
 expect(db.eventSeries.create).not.toHaveBeenCalled();
 db.trainer.findFirst.mockResolvedValue({ id: "trainer-1" });
 expect((await saveSeries("yoga", null, {}, form({ suggestedTrainerId: "trainer-1", suggestedTrainerName: "Ignored" }))).success).toBe(true);
 expect(db.trainer.findFirst).toHaveBeenLastCalledWith({ where: { id: "trainer-1", companyId: "company-id" }, select: { id: true } });
 expect(db.eventSeries.create).toHaveBeenCalledWith({ data: expect.objectContaining({ suggestedTrainerId: "trainer-1", suggestedTrainerName: null }) });
});
it("rejects missing confirmation, missing series and linked events", async () => {
 expect((await deleteSeries("yoga", "series-1", {}, form())).success).toBeUndefined();
 expect(db.eventSeries.deleteMany).not.toHaveBeenCalled();
 db.eventSeries.deleteMany.mockResolvedValue({ count: 0 }); db.eventSeries.updateMany.mockResolvedValue({ count: 0 });
 expect((await deleteSeries("yoga", "series-1", {}, form({ confirmed: "yes" }))).success).toBeUndefined();
 expect((await saveSeries("yoga", "series-1", {}, form())).success).toBeUndefined();
});
it.each([{ suggestedMaxSeats: "1.5" }, { suggestedMaxSeats: "-1" }, { suggestedTicketPrice: "-2" }, { suggestedTicketPrice: "1.234" }, { imageUrl: "javascript:alert(1)" }, { name: " " }])("validates inputs %j", (invalid) => { expect(seriesSchema.safeParse({ ...values, ...invalid }).success).toBe(false); });
it("renders empty table and create option, and redirects guests", async () => {
 const props = { params: Promise.resolve({ companyKey: "yoga" }) };
 const html = renderToStaticMarkup(await Page(props));
 expect(html).toContain("Noch keine Eventserien vorhanden"); expect(html).toContain("+ Eventserie erstellen");
 auth.mockResolvedValue(null); await expect(Page(props)).rejects.toThrow("LOGIN");
 expect((await saveSeries("yoga", null, {}, form())).success).toBeUndefined();
});
it("serializes decimal prices and scopes listing and venue options", async () => {
 db.eventSeries.findMany.mockResolvedValue([{ id: "one", suggestedTicketPrice: { toFixed: () => "12.50" } }]);
 expect((await getCompanySeries("yoga")).series[0].suggestedTicketPrice).toBe("12.50");
 expect(db.eventSeries.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId: "company-id" } }));
 expect(db.venue.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId: "company-id" } }));
});

it.each(["COMPANY_USER", "COMPANY_ADMIN", "ADMIN"])("allows %s to upload a series cover", async (role) => {
 db.user.findUnique.mockResolvedValue({ role: role === "ADMIN" ? "ADMIN" : "USER" });
 db.companyMembership.findUnique.mockResolvedValue({ role, status: "ACTIVE" });
 vi.mocked(uploadEventImage).mockResolvedValue({ imageUrl: "https://example.com/new.jpg", imagePublicId: "new" });
 const data = form(); data.set("coverImage", new File(["image"], "cover.jpg", { type: "image/jpeg" }));
 expect((await saveSeries("yoga", null, {}, data)).success).toBe(true);
 expect(db.eventSeries.create).toHaveBeenCalledWith({ data: expect.objectContaining({ imageUrl: "https://example.com/new.jpg" }) });
 expect(deleteEventImage).not.toHaveBeenCalled();
});
it("rejects uploads for a foreign series before contacting Cloudinary", async () => {
 db.eventSeries.findFirst.mockResolvedValue(null);
 const data = form(); data.set("coverImage", new File(["image"], "cover.jpg", { type: "image/jpeg" }));
 expect((await saveSeries("yoga", "foreign", {}, data)).success).toBeUndefined();
 expect(uploadEventImage).not.toHaveBeenCalled();
});
it("preserves the stored URL on edits and only clears the reference on removal", async () => {
 await saveSeries("yoga", "series-1", {}, form({ imageUrl: "https://untrusted.example/" }));
 expect(db.eventSeries.updateMany.mock.calls[0][0].data).not.toHaveProperty("imageUrl");
 await saveSeries("yoga", "series-1", {}, form({ removeImage: "yes" }));
 expect(db.eventSeries.updateMany.mock.calls[1][0].data.imageUrl).toBeNull();
 await deleteSeries("yoga", "series-1", {}, form({ confirmed: "yes" }));
 expect(deleteEventImage).not.toHaveBeenCalled();
});
it("cleans up only the new unreferenced upload after a failed series save", async () => {
 vi.mocked(uploadEventImage).mockResolvedValue({ imageUrl: "https://example.com/new.jpg", imagePublicId: "new" });
 db.eventSeries.create.mockRejectedValue(new Error("failed"));
 const data = form(); data.set("coverImage", new File(["image"], "cover.jpg", { type: "image/jpeg" }));
 expect((await saveSeries("yoga", null, {}, data)).success).toBeUndefined();
 expect(deleteEventImage).toHaveBeenCalledWith("new");
});

it("stores EUR when currency is omitted or manipulated", async () => {
 const missing = form(); missing.delete("suggestedCurrency");
 expect((await saveSeries("yoga", null, {}, missing)).success).toBe(true);
 expect(db.eventSeries.create.mock.calls[0][0].data.suggestedCurrency).toBe("EUR");
 await saveSeries("yoga", "existing", {}, form({ suggestedCurrency: "USD" }));
 expect(db.eventSeries.updateMany.mock.calls[0][0].data.suggestedCurrency).toBe("EUR");
});
