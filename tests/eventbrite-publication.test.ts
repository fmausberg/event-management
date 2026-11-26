import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { assertTicketPrice, deliverEventbritePublications, queueEventbritePublication } from "@/lib/eventbrite/publication";

const { db, fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  db: {
    $transaction: vi.fn(), event: { findUniqueOrThrow: vi.fn() },
    eventbriteConnection: { findUnique: vi.fn() },
    platformEvent: { create: vi.fn(), findFirst: vi.fn() },
    eventbritePublication: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn(), upsert: vi.fn() },
  },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("@/lib/eventbrite/connection", () => ({ decrypt: () => "private-test-token" }));

let job: { eventId: string; organizationId: string; status: string; venueId: string | null; externalEventId: string | null; ticketClassId: string | null };
let event: { id: string; companyId: string; postToEventbrite: boolean; status: string; beginsAt: Date; endsAt: Date; maxSeats: number; ticketPrice: { toFixed: () => string }; currency: string; name: string; shortdescription: string; description: string; updatedAt: Date; venue: { name: string; countryCode: string; city: string } };
const money = (value: number) => ({ currency: "EUR", value });
const paidTicket = () => ({ id: "300", free: false, include_fee: true, cost: money(1250), tax: money(0) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("EVENTBRITE_LISTED", undefined);
  vi.stubGlobal("fetch", fetchMock);
  job = { eventId: "event-1", organizationId: "10", status: "PENDING", venueId: null, externalEventId: null, ticketClassId: null };
  event = { id: "event-1", companyId: "company", postToEventbrite: true, status: "PUBLISHED",
    beginsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 90_000_000),
    maxSeats: 20, ticketPrice: { toFixed: () => "12.50" }, currency: "EUR", name: "Yoga & mehr",
    shortdescription: "Yoga", description: "<p>Beschreibung</p>", updatedAt: new Date(),
    venue: { name: "Studio", city: "Berlin", countryCode: "DE" },
  };
  db.event.findUniqueOrThrow.mockImplementation(async () => ({ ...event }));
  db.eventbriteConnection.findUnique.mockResolvedValue({ organizationId: "10", status: "CONNECTED", updatedAt: new Date(0), encryptedAccessToken: "ciphertext" });
  db.eventbritePublication.findMany.mockImplementation(async () => job.status === "PENDING" ? [{ ...job }] : []);
  db.eventbritePublication.findUniqueOrThrow.mockImplementation(async () => ({ ...job }));
  db.eventbritePublication.updateMany.mockImplementation(async ({ data }) => {
    if (data.status !== "PROCESSING" || job.status !== "PENDING") return { count: 0 };
    Object.assign(job, data); return { count: 1 };
  });
  db.eventbritePublication.update.mockImplementation(async ({ data }) => { Object.assign(job, data); return { ...job }; });
  db.$transaction.mockImplementation(async fn => fn(db));
  fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    if (path.endsWith("/venues/")) return Response.json({ id: "100" });
    if (path === "/v3/organizations/10/events/") return Response.json({ id: "200" });
    if (path === "/v3/events/200/" && init.method === "GET") return Response.json({ status: "draft" });
    if (path.endsWith("/structured_content/edit/")) return Response.json({ page_version_number: "0" });
    if (path.endsWith("/ticket_classes/")) return Response.json({ id: "300" });
    if (path.endsWith("/ticket_classes/300/")) return Response.json(paidTicket());
    if (path.endsWith("/publish/")) return Response.json({ published: true });
    return Response.json({});
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it.each([
  [undefined, true], ["true", true], ["false", false],
] as const)("creates and publishes an event with EVENTBRITE_LISTED=%s as boolean %s", async (value, listed) => {
  vi.stubEnv("EVENTBRITE_LISTED", value);
  expect(await deliverEventbritePublications()).toEqual({ checked: 1, failures: 0 });
  const created = fetchMock.mock.calls.find(([url]) => new URL(String(url)).pathname === "/v3/organizations/10/events/")!;
  expect(JSON.parse(created[1].body).event.listed).toBe(listed);
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/publish/"))).toBe(true);
  expect(job.status).toBe("PUBLISHED");
});

it.each(["", "TRUE", "False", " false ", "1", "0", "yes"])("rejects invalid EVENTBRITE_LISTED=%j before creating remote resources", async value => {
  vi.stubEnv("EVENTBRITE_LISTED", value);
  expect(await deliverEventbritePublications()).toEqual({ checked: 1, failures: 1 });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(job.status).toBe("ERROR");
  expect(db.eventbritePublication.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({
    lastError: expect.stringContaining("EVENTBRITE_LISTED ist ungültig"),
  }) }));
});

it("applies the current visibility when retrying an existing remote draft without recreating it", async () => {
  job.externalEventId = "200"; job.venueId = "100"; job.ticketClassId = "300";
  vi.stubEnv("EVENTBRITE_LISTED", "false");
  expect(await deliverEventbritePublications()).toEqual({ checked: 1, failures: 0 });
  const updated = fetchMock.mock.calls.find(([url, init]) => new URL(String(url)).pathname === "/v3/events/200/" && init.method === "POST")!;
  expect(JSON.parse(updated[1].body).event.listed).toBe(false);
  expect(db.platformEvent.create).not.toHaveBeenCalled();
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/organizations/10/events/"))).toBe(false);
  expect(job.status).toBe("PUBLISHED");
});

it("does not update published jobs automatically when the visibility setting changes", async () => {
  job.status = "PUBLISHED";
  vi.stubEnv("EVENTBRITE_LISTED", "false");
  expect(await deliverEventbritePublications()).toEqual({ checked: 0, failures: 0 });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("does not enqueue events without an explicit opt-in", async () => {
  event.postToEventbrite = false;
  await queueEventbritePublication(db as unknown as Prisma.TransactionClient, event.id);
  expect(db.eventbritePublication.upsert).not.toHaveBeenCalled();
});

it("persists organization binding and refuses to recreate an existing mapping", async () => {
  db.platformEvent.findFirst.mockResolvedValue({ externalEventId: "999" });
  await queueEventbritePublication(db as unknown as Prisma.TransactionClient, event.id);
  expect(db.eventbritePublication.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: {}, create: expect.objectContaining({ organizationId: "10", externalEventId: "999", status: "UNCERTAIN" }) }));
});

it("saves the remote ID before enabling sales, with the exact gross cents and absorbed fees", async () => {
  expect(await deliverEventbritePublications("company")).toEqual({ checked: 1, failures: 0 });
  expect(job.status).toBe("PUBLISHED");
  expect(db.platformEvent.create).toHaveBeenCalledWith({ data: { eventId: event.id, platform: "EVENTBRITE", externalEventId: "200", syncStatus: "DISABLED" } });
  const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/ticket_classes/"))!;
  expect(JSON.parse(call[1].body).ticket_class).toMatchObject({ cost: "EUR,1250", include_fee: true, capacity: 20, free: false });
  const mapped = db.platformEvent.create.mock.invocationCallOrder[0];
  const publishedIndex = fetchMock.mock.calls.findIndex(([url]) => String(url).endsWith("/publish/"));
  expect(mapped).toBeLessThan(fetchMock.mock.invocationCallOrder[publishedIndex]);
  await deliverEventbritePublications("company");
  expect(db.platformEvent.create).toHaveBeenCalledTimes(1);
});

it("blocks publication if local approvals have been revoked", async () => {
  event.status = "PENDING_TRAINER_CONFIRMATION";
  await deliverEventbritePublications("company");
  expect(fetchMock).not.toHaveBeenCalled();
  expect(job.status).toBe("ERROR");
});

it("does not send an old job to a replacement organization", async () => {
  db.eventbriteConnection.findUnique.mockResolvedValue({ organizationId: "other", status: "CONNECTED" });
  await deliverEventbritePublications();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(job.status).toBe("ERROR");
});

it("does not call Eventbrite if another worker has claimed the job", async () => {
  db.eventbritePublication.updateMany.mockResolvedValue({ count: 0 });
  await deliverEventbritePublications();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("locks an ambiguous create rather than risking a duplicate on the next run", async () => {
  fetchMock.mockRejectedValue(new Error("Timeout"));
  await deliverEventbritePublications();
  expect(job.status).toBe("UNCERTAIN");
  await deliverEventbritePublications();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("locks the job when saving a remote venue ID fails", async () => {
  // The real transaction rolls back its update, leaving the pre-create marker.
  db.$transaction.mockRejectedValue(new Error("DB unavailable"));
  await deliverEventbritePublications();
  expect(job.status).toBe("UNCERTAIN");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each(["live", "started"])("recovers a %s event with missing venue ID and invalid draft configuration without remote writes", async status => {
  job.externalEventId = "200"; job.venueId = null; job.ticketClassId = "300";
  vi.stubEnv("EVENTBRITE_LISTED", "invalid");
  fetchMock.mockResolvedValue(Response.json({ status }));
  await deliverEventbritePublications();
  expect(job.status).toBe("PUBLISHED");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][1].method).toBe("GET");
});

it.each([
  { ...paidTicket(), include_fee: false },
  { ...paidTicket(), cost: money(1500) },
  { ...paidTicket(), tax: money(238) },
])("rejects an unexpected buyer price before publication: %j", ticket => {
  expect(() => assertTicketPrice(ticket, 1250, "EUR")).toThrow();
});

it("accepts a free ticket without inventing a paid ticket price", () => {
  expect(() => assertTicketPrice({ free: true }, 0, "EUR")).not.toThrow();
});

it("keeps the remote draft unpublished when its returned price differs", async () => {
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url: string, init: RequestInit) => String(url).endsWith("/ticket_classes/300/")
    ? Response.json({ ...paidTicket(), cost: money(1500) }) : original(url, init));
  await deliverEventbritePublications();
  expect(job.status).toBe("ERROR");
  expect(job.externalEventId).toBe("200");
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/publish/"))).toBe(false);
});
