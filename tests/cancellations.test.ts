import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { requestCancellation, decideCancellation } from "@/lib/cancellations/service";
import { cancellationTransaction } from "@/lib/cancellations/transaction";
import { getCompanyCancellations } from "@/lib/cancellations/data";

const { db, auth, queue } = vi.hoisted(() => ({
  auth: vi.fn(), queue: vi.fn(), db: {
    $transaction: vi.fn(), user: { findUnique: vi.fn() }, companyMembership: { findUnique: vi.fn() }, company: { findUnique: vi.fn() },
    booking: { findUnique: vi.fn(), update: vi.fn() }, ticket: { updateMany: vi.fn() },
    cancellationRequest: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("@/lib/cancellations/mail", () => ({ queueCancellationMail: queue }));
const booking = () => ({ id: "booking", userId: "owner", status: "CONFIRMED", event: { companyId: "company", beginsAt: new Date("2026-10-29T10:00Z"), freeCancellationUntilMinutesBeforeStart: 1440 }, payment: { status: "PAID" }, cancellationRequests: [] });
const request = () => ({ id: "request", bookingId: "booking", status: "PENDING", booking: booking() });
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-28T10:00Z"));
  auth.mockResolvedValue({ user: { id: "owner" } }); db.user.findUnique.mockResolvedValue({ role: "USER" });
  db.$transaction.mockImplementation((fn) => fn(db));
  db.booking.findUnique.mockResolvedValue(booking()); db.cancellationRequest.findUnique.mockResolvedValue(request());
  db.cancellationRequest.create.mockImplementation(({ data }) => Promise.resolve({ ...data, id: "request" }));
  db.cancellationRequest.updateMany.mockResolvedValue({ count: 1 });
  db.company.findUnique.mockResolvedValue({ id: "company", slug: "studio", name: "Studio" });
  db.cancellationRequest.findMany.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());
it("auto-approves exactly at the cutoff, atomically cancels tickets, and queues mail", async () => {
  expect(await requestCancellation("booking", "", "free")).toMatchObject({ status: "APPROVED", automatic: true, refundStatus: "PENDING" });
  expect(db.booking.update).toHaveBeenCalledWith({ where: { id: "booking" }, data: { status: "CANCELLED" } });
  expect(db.ticket.updateMany).toHaveBeenCalledWith({ where: { bookingId: "booking" }, data: { status: "CANCELLED" } });
  expect(queue).toHaveBeenCalledWith(db, "request", "approved");
});
it("does not trust a stale free-cancellation button", async () => {
  vi.setSystemTime(new Date("2026-10-28T10:00:00.001Z"));
  await expect(requestCancellation("booking", "", "free")).rejects.toThrow("Frist");
  expect(db.cancellationRequest.create).not.toHaveBeenCalled();
});
it("a request alone never changes tickets or booking, even inside the free window", async () => {
  expect(await requestCancellation("booking", "Bitte prüfen", "request")).toMatchObject({ status: "PENDING", customerReason: "Bitte prüfen" });
  expect(db.booking.update).not.toHaveBeenCalled(); expect(db.ticket.updateMany).not.toHaveBeenCalled();
  expect(queue).toHaveBeenCalledWith(db, "request", "requested");
});
it("allows manual requests for events without a start", async () => {
  db.booking.findUnique.mockResolvedValue({ ...booking(), event: { ...booking().event, beginsAt: null } });
  await expect(requestCancellation("booking", "", "free")).rejects.toThrow("Frist");
  expect(await requestCancellation("booking", "", "request")).toMatchObject({ status: "PENDING" });
});
it.each(["CANCELLED", "PENDING_PAYMENT", "EXPIRED"])("rejects ineligible booking %s", async (status) => {
  db.booking.findUnique.mockResolvedValue({ ...booking(), status });
  await expect(requestCancellation("booking", "", "request")).rejects.toThrow("bestätigte");
});
it.each(["PENDING", "EXPIRED", "REFUNDED", "PARTIALLY_REFUNDED"])("rejects payment status %s", async (status) => {
  db.booking.findUnique.mockResolvedValue({ ...booking(), payment: { status } });
  await expect(requestCancellation("booking", "", "request")).rejects.toThrow("bezahlt");
});
it("rejects requests and approval once the event starts", async () => {
  vi.setSystemTime(booking().event.beginsAt);
  await expect(requestCancellation("booking", "", "request")).rejects.toThrow("begonnen");
  db.user.findUnique.mockResolvedValue({ role: "ADMIN" });
  await expect(decideCancellation("request", "APPROVED")).rejects.toThrow("begonnen");
});
it("rejects guests and other booking owners", async () => {
  auth.mockResolvedValue(null); await expect(requestCancellation("booking", "", "request")).rejects.toThrow();
  auth.mockResolvedValue({ user: { id: "other" } }); await expect(requestCancellation("booking", "", "request")).rejects.toThrow();
  expect(db.cancellationRequest.create).not.toHaveBeenCalled();
});
it.each([null, { status: "INVITED", role: "COMPANY_USER" }, { status: "SUSPENDED", role: "COMPANY_USER" }, { status: "SUSPENDED", role: "COMPANY_ADMIN" }])("rejects unauthorized decision %j", async (membership) => {
  db.companyMembership.findUnique.mockResolvedValue(membership);
  await expect(decideCancellation("request", "APPROVED")).rejects.toThrow();
  expect(db.cancellationRequest.updateMany).not.toHaveBeenCalled();
});
it.each(["COMPANY_ADMIN", "COMPANY_USER"])("allows active %s to view company requests and approve/reject another customer's request", async (role) => {
  auth.mockResolvedValue({ user: { id: "colleague" } });
  db.companyMembership.findUnique.mockResolvedValue({ status: "ACTIVE", role });
  await getCompanyCancellations("studio");
  expect(db.cancellationRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { booking: { event: { companyId: "company" } } } }));
  await decideCancellation("request", "APPROVED");
  await decideCancellation("request", "REJECTED");
  expect(db.companyMembership.findUnique).toHaveBeenCalledWith({ where: { companyId_userId: { companyId: "company", userId: "colleague" } } });
  expect(db.cancellationRequest.updateMany).toHaveBeenCalledTimes(2);
});
it.each([null, { status: "INVITED", role: "COMPANY_USER" }, { status: "SUSPENDED", role: "COMPANY_USER" }])("denies the overview without active membership %j", async (membership) => {
  db.companyMembership.findUnique.mockResolvedValue(membership);
  await expect(getCompanyCancellations("studio")).rejects.toThrow();
  expect(db.cancellationRequest.findMany).not.toHaveBeenCalled();
});
it("requires the membership of the booking's company, not a client-supplied company", async () => {
  db.companyMembership.findUnique.mockResolvedValue({ status: "ACTIVE", role: "COMPANY_ADMIN" });
  await decideCancellation("request", "APPROVED", "intern");
  expect(db.companyMembership.findUnique).toHaveBeenCalledWith({ where: { companyId_userId: { companyId: "company", userId: "owner" } } });
  expect(db.cancellationRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "request", status: "PENDING" }, data: expect.objectContaining({ status: "APPROVED", decidedById: "owner", decidedAt: expect.any(Date), internalNote: "intern", refundStatus: "PENDING" }) }));
});
it("rejects without cancellation and records the decision", async () => {
  db.user.findUnique.mockResolvedValue({ role: "ADMIN" });
  await decideCancellation("request", "REJECTED", "interne Notiz");
  expect(queue).toHaveBeenCalledWith(db, "request", "rejected");
  expect(db.booking.update).not.toHaveBeenCalled(); expect(db.ticket.updateMany).not.toHaveBeenCalled();
});
it("allows only the owner to withdraw an undecided request", async () => {
  await decideCancellation("request", "WITHDRAWN");
  expect(db.cancellationRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "WITHDRAWN" }) }));
  expect(queue).not.toHaveBeenCalled(); expect(db.booking.update).not.toHaveBeenCalled();
  auth.mockResolvedValue({ user: { id: "other" } });
  await expect(decideCancellation("request", "WITHDRAWN")).rejects.toThrow();
});
it.each(["APPROVED", "REJECTED", "WITHDRAWN"])("cannot decide a %s request again", async (status) => {
  db.user.findUnique.mockResolvedValue({ role: "ADMIN" });
  db.cancellationRequest.findUnique.mockResolvedValue({ ...request(), status });
  if (status === "APPROVED") await expect(decideCancellation("request", "APPROVED")).resolves.toBe("request");
  else await expect(decideCancellation("request", "APPROVED")).rejects.toThrow("bereits");
  expect(db.booking.update).not.toHaveBeenCalled();
});
it("returns an existing active request on repeat clicks", async () => {
  db.booking.findUnique.mockResolvedValue({ ...booking(), cancellationRequests: [{ id: "existing", status: "PENDING" }] });
  expect(await requestCancellation("booking", "", "request")).toMatchObject({ id: "existing" });
  expect(db.cancellationRequest.create).not.toHaveBeenCalled();
});
it("a lost decision race cannot cancel the booking", async () => {
  db.user.findUnique.mockResolvedValue({ role: "ADMIN" });
  db.cancellationRequest.updateMany.mockResolvedValue({ count: 0 });
  await expect(decideCancellation("request", "APPROVED")).rejects.toThrow("bereits");
  expect(db.booking.update).not.toHaveBeenCalled();
});
it("confirmed bookings without online payment do not create a refund operation", async () => {
  db.booking.findUnique.mockResolvedValue({ ...booking(), payment: null });
  expect(await requestCancellation("booking", "", "free")).toMatchObject({ status: "APPROVED", refundStatus: "NONE" });
});
it("retries serialization conflicts with a fresh transaction", async () => {
  db.$transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("conflict", { code: "P2034", clientVersion: "7" }));
  expect(await cancellationTransaction(async () => "ok")).toBe("ok");
  expect(db.$transaction).toHaveBeenCalledTimes(2);
});
