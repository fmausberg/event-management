import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { deliverPendingEventbriteCapacity } from "@/lib/eventbrite/capacity";
import { eventbriteCapacityTarget } from "@/lib/eventbrite/capacity-model";

const { db, fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn(), db: {
  $transaction: vi.fn(), $queryRaw: vi.fn(),
  eventbriteCapacitySync: { findMany: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  event: { findUniqueOrThrow: vi.fn() }, booking: { aggregate: vi.fn() }, eventbriteConnection: { findUnique: vi.fn() },
} }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("@/lib/eventbrite/connection", () => ({ decrypt: () => "test-private-token" }));

let job: { eventId: string; revision: number; syncedRevision: number; retryAt: Date | null; lastCapacity: number | null; lastError: string | null; lastSyncedAt: Date | null };
let maximum: number, reserved: number, sold: number, held: number, remoteCapacity: number, ticketCapacity: number;

beforeEach(() => {
  vi.resetAllMocks(); vi.stubGlobal("fetch", fetchMock);
  job = { eventId: "local", revision: 1, syncedRevision: 0, retryAt: new Date(0), lastCapacity: null, lastError: null, lastSyncedAt: null };
  maximum = 10; reserved = 2; sold = 3; held = 0; remoteCapacity = 10; ticketCapacity = 10;
  db.$transaction.mockImplementation(async work => work(db));
  db.$queryRaw.mockResolvedValue([{ locked: true }]);
  db.eventbriteCapacitySync.findMany.mockImplementation(async () => job.retryAt && job.retryAt <= new Date() ? [{ eventId: job.eventId, revision: job.revision }] : []);
  db.eventbriteCapacitySync.findUnique.mockImplementation(async () => ({ ...job }));
  db.eventbriteCapacitySync.findUniqueOrThrow.mockImplementation(async () => ({ ...job }));
  db.eventbriteCapacitySync.update.mockImplementation(async ({ data }) => { Object.assign(job, data); return { ...job }; });
  db.eventbriteCapacitySync.updateMany.mockImplementation(async ({ where, data }) => {
    if (where.revision !== undefined && where.revision !== job.revision) return { count: 0 };
    Object.assign(job, data); return { count: 1 };
  });
  db.booking.aggregate.mockImplementation(async () => ({ _sum: { quantity: reserved } }));
  db.eventbriteConnection.findUnique.mockResolvedValue({ status: "CONNECTED", organizationId: "20", encryptedAccessToken: "ciphertext", updatedAt: new Date(0) });
  db.event.findUniqueOrThrow.mockImplementation(async () => ({ id: "local", companyId: "company", postToEventbrite: true,
    status: "PUBLISHED", updatedAt: new Date(0), endsAt: new Date(Date.now() + 86400000), maxSeats: maximum,
    eventbritePublication: { status: "PUBLISHED", externalEventId: "100", ticketClassId: "200", organizationId: "20" },
  }));
  fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    if (path === "/v3/events/100/") return Response.json({ id: "100", organization_id: "20", status: "live" });
    if (path.endsWith("/capacity_tier/")) {
      if (init.method === "POST") remoteCapacity = JSON.parse(String(init.body)).capacity_tier.capacity_total;
      return Response.json({ capacity_total: remoteCapacity, capacity_sold: sold, capacity_pending: held, holds: [] });
    }
    if (path.endsWith("/ticket_classes/200/")) {
      if (init.method === "POST") ticketCapacity = JSON.parse(String(init.body)).ticket_class.capacity;
      return Response.json({ id: "200", capacity: ticketCapacity, inventory_tier_id: null });
    }
    throw new Error("Unexpected path");
  });
});
afterEach(() => vi.unstubAllGlobals());

it("keeps 8 total and 5 free after 2 local tickets and 3 Eventbrite tickets", async () => {
  expect(await deliverPendingEventbriteCapacity()).toEqual({ checked: 1, failures: 0 });
  expect(remoteCapacity).toBe(8);
  expect(remoteCapacity - sold).toBe(5);
  expect(job).toMatchObject({ lastCapacity: 8, syncedRevision: 1, retryAt: null, lastError: null });
  expect(db.booking.aggregate).toHaveBeenCalledWith({ where: {
    eventId: "local", status: { in: ["CONFIRMED", "PENDING_PAYMENT"] }, OR: [{ platform: null }, { platform: { not: "EVENTBRITE" } }],
  }, _sum: { quantity: true } });
});

it("restores stock after local cancellation or verified expiry", async () => {
  await deliverPendingEventbriteCapacity();
  reserved = 0; job.revision++; job.retryAt = new Date(0);
  await deliverPendingEventbriteCapacity();
  expect(remoteCapacity).toBe(10);
  expect(remoteCapacity - sold).toBe(7);
});

it("sets an event capacity of zero without creating a zero-capacity ticket class", async () => {
  reserved = 10; sold = 0;
  await deliverPendingEventbriteCapacity();
  expect(remoteCapacity).toBe(0);
  expect(ticketCapacity).toBe(10);
  expect(job.retryAt).toBeNull();
});

it("raises ticket capacity before raising the event limit", async () => {
  maximum = 20; reserved = 0;
  await deliverPendingEventbriteCapacity();
  const writes = fetchMock.mock.calls.filter(([, init]) => init.method === "POST").map(([url]) => new URL(String(url)).pathname);
  expect(writes).toEqual(["/v3/events/100/ticket_classes/200/", "/v3/events/100/capacity_tier/"]);
  expect(remoteCapacity).toBe(20);
});

it("reduces the event limit before reducing a ticket class", async () => {
  maximum = 8; reserved = 2;
  await deliverPendingEventbriteCapacity();
  const writes = fetchMock.mock.calls.filter(([, init]) => init.method === "POST").map(([url]) => new URL(String(url)).pathname);
  expect(writes).toEqual(["/v3/events/100/capacity_tier/", "/v3/events/100/ticket_classes/200/"]);
  expect(remoteCapacity).toBe(6);
});

it("closes remaining sales and reports overbooking instead of setting a limit below sold/held tickets", async () => {
  reserved = 9; sold = 3; held = 1;
  expect((await deliverPendingEventbriteCapacity()).failures).toBe(1);
  expect(remoteCapacity).toBe(4);
  expect(job.lastError).toContain("mehr Tickets");
  expect(job.syncedRevision).toBe(0);
  expect(job.retryAt).not.toBeNull();
});

it("does not run concurrently with another instance for the same event", async () => {
  db.$queryRaw.mockResolvedValue([{ locked: false }]);
  await deliverPendingEventbriteCapacity();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(job.retryAt).not.toBeNull();
});

it("keeps a newer booking revision pending if it commits during the provider write", async () => {
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
    if (init.method === "POST") { job.revision = 2; reserved = 3; }
    return original(url, init);
  });
  await deliverPendingEventbriteCapacity();
  expect(job.syncedRevision).toBe(1);
  expect(job.revision).toBe(2);
  expect(job.retryAt).not.toBeNull();
  fetchMock.mockImplementation(original);
  await deliverPendingEventbriteCapacity();
  expect(remoteCapacity).toBe(7);
  expect(job.syncedRevision).toBe(2);
});

it("does not apply an old snapshot if a newer revision is already visible before the write", async () => {
  db.eventbriteCapacitySync.findUniqueOrThrow.mockResolvedValue({ revision: 2 });
  await deliverPendingEventbriteCapacity();
  expect(fetchMock.mock.calls.some(([, init]) => init.method === "POST")).toBe(false);
  expect(job.retryAt).not.toBeNull();
});

it("persists a safe error and retries later when Eventbrite rejects the update", async () => {
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url: string, init: RequestInit) => init.method === "POST"
    ? Response.json({ error_description: "test-private-token" }, { status: 400 }) : original(url, init));
  expect((await deliverPendingEventbriteCapacity()).failures).toBe(1);
  expect(job.lastError).toContain("HTTP 400");
  expect(job.lastError).not.toContain("test-private-token");
  expect(job.lastSyncedAt).toBeNull();
  expect(job.retryAt!.getTime()).toBeGreaterThan(Date.now());
});

it("rejects a replacement organization before any remote write", async () => {
  db.eventbriteConnection.findUnique.mockResolvedValue({ status: "CONNECTED", organizationId: "999" });
  await deliverPendingEventbriteCapacity();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("keeps event cancellations manual", async () => {
  db.event.findUniqueOrThrow.mockResolvedValue({ status: "CANCELLED" });
  await deliverPendingEventbriteCapacity();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("does not resend an already acknowledged job", async () => {
  await deliverPendingEventbriteCapacity();
  fetchMock.mockClear();
  expect(await deliverPendingEventbriteCapacity()).toEqual({ checked: 0, failures: 0 });
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each([[10, 2, 8], [10, 10, 0], [10, 12, 0], [0, 0, 0]])("calculates capacity from maximum %i and non-Eventbrite reservations %i", (max, local, expected) => {
  expect(eventbriteCapacityTarget(max, local)).toBe(expected);
});
