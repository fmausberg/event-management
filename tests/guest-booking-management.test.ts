import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createBookingManagementToken } from "@/lib/bookings/management-token";
import { getGuestBooking } from "@/lib/bookings/guest-management";
import { requestCancellationWithToken } from "@/lib/cancellations/service";
import { cancelGuestBooking, loadGuestBooking } from "@/app/(public)/booking/manage/actions";

const { db, auth, queueMail, deliverMails, refund } = vi.hoisted(() => ({
  auth: vi.fn(), queueMail: vi.fn(), deliverMails: vi.fn(), refund: vi.fn(), db: {
    $transaction: vi.fn(), booking: { findUnique: vi.fn(), update: vi.fn() }, ticket: { updateMany: vi.fn() },
    cancellationRequest: { create: vi.fn() }, user: { findUnique: vi.fn() },
  },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("@/lib/cancellations/mail", () => ({ queueCancellationMail: queueMail, deliverCancellationMails: deliverMails }));
vi.mock("@/lib/cancellations/refunds", () => ({ processCancellationRefund: refund }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

function record() {
  return { id: "booking-1", number: 42, quantity: 3, userId: null, customerEmail: "guest@example.com", status: "CONFIRMED",
    payment: null as { status: string } | null,
    event: { companyId: "company-1", name: "Yoga", company: { name: "Studio" }, beginsAt: new Date("2026-11-05T12:00:00Z"), freeCancellationUntilMinutesBeforeStart: 1440 as number | null },
    cancellationRequests: [] as { id: string; status: "PENDING" | "APPROVED"; refundStatus: "PENDING" | "NONE"; bookingId: string }[],
  };
}
let booking: ReturnType<typeof record>;
const token = () => createBookingManagementToken(booking);
function form(intent = "free") {
  const data = new FormData(); data.set("intent", intent); data.set("confirmed", "yes"); data.set("note", ""); return data;
}
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-02T10:00:00Z"));
  vi.stubEnv("AUTH_SECRET", "guest-management-secret");
  booking = record();
  auth.mockResolvedValue(null);
  db.booking.findUnique.mockImplementation(async () => booking);
  db.booking.update.mockImplementation(async ({ data }) => { Object.assign(booking, data); return booking; });
  db.$transaction.mockImplementation(async fn => fn(db));
  db.cancellationRequest.create.mockImplementation(async ({ data }) => { const request = { id: "request-1", ...data }; booking.cancellationRequests.push(request); return request; });
  deliverMails.mockResolvedValue(0);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

it("opens the whole booking without login and does not cancel on page load", async () => {
  expect(await loadGuestBooking(token())).toMatchObject({ booking: { number: 42, quantity: 3, eventName: "Yoga", free: true, canCancel: true } });
  expect(db.cancellationRequest.create).not.toHaveBeenCalled();
  expect(auth).not.toHaveBeenCalled();
  const data = JSON.stringify(await getGuestBooking(token()));
  expect(data).not.toContain("guest@example.com");
  expect(data).not.toContain("booking-1");
});

it("cancels every ticket of a complimentary guest booking without a refund", async () => {
  const data = form(); data.set("id", "another-booking");
  const result = await cancelGuestBooking(token(), {}, data);
  expect(result).toMatchObject({ success: true, booking: { status: "CANCELLED", canCancel: false } });
  expect(db.booking.update).toHaveBeenCalledWith({ where: { id: "booking-1" }, data: { status: "CANCELLED" } });
  expect(db.ticket.updateMany).toHaveBeenCalledWith({ where: { bookingId: "booking-1" }, data: { status: "CANCELLED" } });
  expect(db.cancellationRequest.create.mock.calls[0][0].data).toMatchObject({ decidedById: null, refundStatus: "NONE" });
  expect(queueMail).toHaveBeenCalledWith(db, "request-1", "approved");
  expect(refund).not.toHaveBeenCalled();
  expect(auth).not.toHaveBeenCalled();
});

it("hands paid cancellations to the existing refund flow only after commit", async () => {
  booking.payment = { status: "PAID" };
  let committed = false;
  db.$transaction.mockImplementation(async fn => { const result = await fn(db); committed = true; return result; });
  refund.mockImplementation(async () => { expect(committed).toBe(true); });
  expect((await cancelGuestBooking(token(), {}, form())).success).toBe(true);
  expect(refund).toHaveBeenCalledWith("request-1");
});

it("keeps pending requests and approvals idempotent on repeat submissions", async () => {
  const managementToken = token();
  await cancelGuestBooking(managementToken, {}, form());
  expect((await cancelGuestBooking(managementToken, {}, form())).success).toBe(true);
  expect(db.cancellationRequest.create).toHaveBeenCalledOnce();
  expect(db.ticket.updateMany).toHaveBeenCalledOnce();
});

it("uses request-only cancellation outside the free window and refuses a stale free action", async () => {
  vi.setSystemTime(new Date("2026-11-05T10:00:00Z"));
  expect((await getGuestBooking(token()))?.free).toBe(false);
  expect((await cancelGuestBooking(token(), {}, form())).message).toContain("Frist");
  expect(db.cancellationRequest.create).not.toHaveBeenCalled();
  expect((await cancelGuestBooking(token(), {}, form("request"))).success).toBe(true);
  expect(booking.cancellationRequests[0].status).toBe("PENDING");
  expect(booking.status).toBe("CONFIRMED");
  expect(db.ticket.updateMany).not.toHaveBeenCalled();
  expect(queueMail).toHaveBeenCalledWith(db, "request-1", "requested");
});

it("supports request-only events and never silently upgrades an explicit request", async () => {
  booking.event.freeCancellationUntilMinutesBeforeStart = null;
  expect((await getGuestBooking(token()))?.free).toBe(false);
  await requestCancellationWithToken(token(), "Bitte prüfen", "request");
  expect(db.ticket.updateMany).not.toHaveBeenCalled();
  expect(booking.cancellationRequests[0].status).toBe("PENDING");
});

it("requires explicit confirmation and rejects privileged intents", async () => {
  const data = form(); data.delete("confirmed");
  expect((await cancelGuestBooking(token(), {}, data)).success).toBeUndefined();
  for (const intent of ["approve", "reject", "retry", "withdraw"]) expect((await cancelGuestBooking(token(), {}, form(intent))).success).toBeUndefined();
  expect(db.cancellationRequest.create).not.toHaveBeenCalled();
});

it("rejects ticket tokens before querying any booking", async () => {
  expect((await loadGuestBooking("a".repeat(43))).booking).toBeUndefined();
  expect((await cancelGuestBooking("a".repeat(43), {}, form())).success).toBeUndefined();
  expect(db.booking.findUnique).not.toHaveBeenCalled();
  expect(db.cancellationRequest.create).not.toHaveBeenCalled();
});

it("revokes access when the booking email changes, including during mutation", async () => {
  const managementToken = token();
  booking.customerEmail = "changed@example.com";
  expect(await getGuestBooking(managementToken)).toBeNull();
  expect((await cancelGuestBooking(managementToken, {}, form())).success).toBeUndefined();
  expect(db.cancellationRequest.create).not.toHaveBeenCalled();
});

it("blocks cancellation after the event begins", async () => {
  vi.setSystemTime(booking.event.beginsAt);
  expect((await getGuestBooking(token()))?.canCancel).toBe(false);
  expect((await cancelGuestBooking(token(), {}, form())).message).toContain("begonnen");
  expect(db.ticket.updateMany).not.toHaveBeenCalled();
});

it("reports a committed cancellation as successful if downstream refund or email delivery fails", async () => {
  booking.payment = { status: "PAID" };
  refund.mockRejectedValue(new Error("Stripe offline"));
  deliverMails.mockRejectedValue(new Error("SMTP offline"));
  const result = await cancelGuestBooking(token(), {}, form());
  expect(result).toMatchObject({ success: true, booking: { status: "CANCELLED", cancellation: { refund: "Erstattung ausstehend" } } });
  expect(result.message).toContain("vorgemerkt");
});
