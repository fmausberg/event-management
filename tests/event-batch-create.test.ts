import { beforeEach, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { saveEvent, getSeriesDateConflicts } from "@/app/company/[companyKey]/events/actions";
import { emptyEvent } from "@/lib/company-events/model";
import { revalidatePath } from "next/cache";
import { uploadEventImage, deleteEventImage } from "@/lib/events/images";

const { auth, db } = vi.hoisted(() => ({ auth: vi.fn(), db: {
  user: { findUnique: vi.fn() }, company: { findUnique: vi.fn() }, companyMembership: { findUnique: vi.fn() },
  eventSeries: { findFirst: vi.fn() }, venue: { findFirst: vi.fn() }, trainer: { findMany: vi.fn() },
  event: { findMany: vi.fn(), create: vi.fn() }, $transaction: vi.fn(),
} }));
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/events/images", async original => ({ ...await original<typeof import("@/lib/events/images")>(), uploadEventImage: vi.fn(), deleteEventImage: vi.fn() }));

function form(intent = "draft", dates = ["2099-03-28", "2099-03-29"]) {
  const data = new FormData();
  Object.entries({ ...emptyEvent, name: "Workshop", shortdescription: "Kurz", description: "Beschreibung", eventSeriesId: "series", venueId: "venue", maxSeats: "20", ticketPrice: "19,50", freeCancellationUntilMinutesBeforeStart: "1440" }).forEach(([key, value]) => { if (typeof value === "string") data.set(key, value); });
  data.append("trainerIds", "trainer");
  data.set("creationMode", "multiple"); data.set("intent", intent);
  data.set("batchStartTime", "10:00"); data.set("batchEndTime", "11:30");
  dates.forEach(date => data.append("batchDate", date));
  return data;
}
beforeEach(() => {
  vi.resetAllMocks();
  auth.mockResolvedValue({ user: { id: "actor" } });
  db.user.findUnique.mockResolvedValue({ role: "USER" });
  db.company.findUnique.mockResolvedValue({ id: "company", slug: "studio" });
  db.companyMembership.findUnique.mockResolvedValue({ role: "COMPANY_USER", status: "ACTIVE" });
  db.eventSeries.findFirst.mockResolvedValue({ id: "series", imageUrl: "https://example.com/series.jpg" });
  db.venue.findFirst.mockResolvedValue({ id: "venue" });
  db.trainer.findMany.mockResolvedValue([{ id: "trainer" }]);
  db.event.findMany.mockResolvedValue([]);
  db.$transaction.mockImplementation(async fn => fn(db));
  vi.mocked(uploadEventImage).mockResolvedValue({ imageUrl: "https://example.com/upload.jpg", imagePublicId: "fresh-upload" });
  vi.mocked(deleteEventImage).mockResolvedValue(true);
});

it.each(["draft", "publish"])("creates the entire %s batch with the form values and trainer relations in one serializable transaction", async intent => {
  let inTransaction = false;
  db.$transaction.mockImplementation(async fn => { inTransaction = true; try { return await fn(db); } finally { inTransaction = false; } });
  db.event.create.mockImplementation(async () => { expect(inTransaction).toBe(true); return { id: "created" }; });
  const result = await saveEvent("studio", null, {}, form(intent));
  expect(result).toMatchObject({ success: true, message: expect.stringContaining("2 Events") });
  expect(db.event.create).toHaveBeenCalledTimes(2);
  const rows = db.event.create.mock.calls.map(([args]) => args.data);
  expect(rows[0]).toMatchObject({ name: "Workshop", status: intent === "publish" ? "PUBLISHED" : "DRAFT", companyId: "company", createdById: "actor", eventSeriesId: "series", venueId: "venue", ticketPrice: "19.50", maxSeats: 20, freeCancellationUntilMinutesBeforeStart: 1440, imageUrl: "https://example.com/series.jpg", trainers: { create: [{ trainerId: "trainer" }] } });
  expect(rows[0].beginsAt).not.toEqual(rows[1].beginsAt);
  expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable", timeout: 30000 });
  expect(revalidatePath).toHaveBeenCalledWith("/company/studio/events");
});

it("rolls back a failure on the second event and cleans up the uploaded asset", async () => {
  const committed: unknown[] = [];
  const staged: unknown[] = [];
  db.$transaction.mockImplementation(async fn => { const result = await fn(db); committed.push(...staged); return result; });
  db.event.create.mockImplementationOnce(async args => { staged.push(args); }).mockRejectedValueOnce(new Error("database unavailable"));
  const data = form(); data.set("coverImage", new File(["image"], "cover.jpg", { type: "image/jpeg" }));
  expect((await saveEvent("studio", null, {}, data)).success).toBeUndefined();
  expect(committed).toEqual([]);
  expect(deleteEventImage).toHaveBeenCalledWith("fresh-upload");
  expect(revalidatePath).not.toHaveBeenCalled();
});

it.each(["draft", "publish"])("allows additional same-series events on occupied dates for %s", async intent => {
  db.event.findMany.mockResolvedValue([{ beginsAt: new Date("2099-03-28T18:00:00Z") }]);
  expect(await saveEvent("studio", null, {}, form(intent))).toMatchObject({ success: true });
  expect(db.event.create).toHaveBeenCalledTimes(2);
});

it("requires one collective optional-fields confirmation before uploading or creating anything", async () => {
  db.eventSeries.findFirst.mockResolvedValue({ id: "series", imageUrl: null }); db.trainer.findMany.mockResolvedValue([]);
  const data = form("publish"); data.delete("trainerIds"); data.set("description", "");
  expect((await saveEvent("studio", null, {}, data)).warnings).toEqual(["Titelbild", "Trainer", "Beschreibung"]);
  expect(db.$transaction).not.toHaveBeenCalled(); expect(uploadEventImage).not.toHaveBeenCalled();
  data.set("confirmMissingOptional", "yes");
  expect((await saveEvent("studio", null, {}, data)).success).toBe(true);
});

it.each(["name", "shortdescription", "venueId", "ticketPrice", "maxSeats", "batchEndTime"])("rejects publication with missing %s for the entire batch", async key => {
  const data = form("publish"); data.set(key, ""); data.set("confirmMissingOptional", "yes");
  expect((await saveEvent("studio", null, {}, data)).success).toBeUndefined();
  expect(db.event.create).not.toHaveBeenCalled();
});

it("rejects publication when any occurrence has ended, and rejects duplicate input dates", async () => {
  expect((await saveEvent("studio", null, {}, form("publish", ["2000-01-01", "2099-03-28"]))).dateErrors?.["2000-01-01"]).toBeTruthy();
  expect((await saveEvent("studio", null, {}, form("draft", ["2099-03-28", "2099-03-28"]))).message).toContain("nur einmal");
  expect(db.event.create).not.toHaveBeenCalled();
});

it.each(["series", "venue", "trainer", "membership"])("rechecks %s access inside the transaction", async field => {
  if (field === "series") db.eventSeries.findFirst.mockResolvedValueOnce({ id: "series", imageUrl: "https://example.com/series.jpg" }).mockResolvedValue(null);
  if (field === "venue") db.venue.findFirst.mockResolvedValueOnce({ id: "venue" }).mockResolvedValue(null);
  if (field === "trainer") db.trainer.findMany.mockResolvedValueOnce([{ id: "trainer" }]).mockResolvedValue([]);
  if (field === "membership") db.companyMembership.findUnique.mockResolvedValueOnce({ role: "COMPANY_USER", status: "ACTIVE" }).mockResolvedValue({ role: "COMPANY_USER", status: "SUSPENDED" });
  expect((await saveEvent("studio", null, {}, form())).success).toBeUndefined();
  expect(db.event.create).not.toHaveBeenCalled();
});

it("requires authentication, a series, new records and a supported creation intent", async () => {
  expect((await saveEvent("studio", "existing", {}, form())).success).toBeUndefined();
  expect((await saveEvent("studio", null, {}, form("save"))).success).toBeUndefined();
  const noSeries = form(); noSeries.set("eventSeriesId", "");
  expect((await saveEvent("studio", null, {}, noSeries)).success).toBeUndefined();
  auth.mockResolvedValue(null);
  expect((await saveEvent("studio", null, {}, form())).success).toBeUndefined();
  expect(db.event.create).not.toHaveBeenCalled();
});

it("reports a concurrent serializable conflict without success or partial refreshes", async () => {
  db.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("conflict", { code: "P2034", clientVersion: "7" }));
  expect((await saveEvent("studio", null, {}, form())).message).toContain("gleichzeitig");
  expect(revalidatePath).not.toHaveBeenCalled();
});

it("scopes preview conflicts and converts UTC events to Berlin calendar dates", async () => {
  db.event.findMany.mockResolvedValue([{ beginsAt: new Date("2027-03-27T23:30:00Z") }]);
  expect(await getSeriesDateConflicts("studio", "series", "2027-03-28", "2027-03-29")).toEqual({ dates: ["2027-03-28"] });
  db.eventSeries.findFirst.mockResolvedValue(null); db.event.findMany.mockClear();
  expect((await getSeriesDateConflicts("studio", "foreign", "2027-03-28", "2027-03-29")).message).toBeTruthy();
  expect(db.event.findMany).not.toHaveBeenCalled();
});
