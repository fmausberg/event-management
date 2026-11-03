import "server-only";
import { getPrisma } from "@/lib/db/prisma";
import { cancellationPolicy, refundLabels, requestLabels } from "@/lib/cancellations/policy";
import { managementTokenMatchesBooking, readBookingManagementToken } from "./management-token";

export type GuestBooking = {
  number: number;
  quantity: number;
  status: string;
  eventName: string;
  companyName: string;
  beginsAt: string | null;
  deadline: string | null;
  free: boolean;
  canCancel: boolean;
  unavailableReason: string | null;
  cancellation: { status: string; refund: string } | null;
};

export async function getGuestBooking(token: string): Promise<GuestBooking | null> {
  const payload = readBookingManagementToken(token);
  if (!payload) return null;
  const booking = await getPrisma().booking.findUnique({ where: { id: payload.bookingId }, select: {
    id: true, customerEmail: true, number: true, quantity: true, status: true,
    event: { select: { name: true, beginsAt: true, freeCancellationUntilMinutesBeforeStart: true, company: { select: { name: true } } } },
    payment: { select: { status: true } },
    cancellationRequests: { orderBy: { requestedAt: "desc" }, select: { status: true, refundStatus: true } },
  } });
  if (!booking || !managementTokenMatchesBooking(payload, booking)) return null;
  const policy = cancellationPolicy(booking.event.beginsAt, booking.event.freeCancellationUntilMinutesBeforeStart);
  const active = booking.cancellationRequests.find(request => ["PENDING", "APPROVED"].includes(request.status));
  const latest = active ?? booking.cancellationRequests[0];
  const unavailableReason = booking.status === "CANCELLED" ? "Diese Buchung und alle zugehörigen Tickets sind storniert."
    : active ? "Für diese Buchung liegt bereits eine Stornierung oder Stornierungsanfrage vor."
    : policy.started ? "Die Veranstaltung hat bereits begonnen. Eine Stornierung ist nicht mehr möglich."
    : booking.status !== "CONFIRMED" || booking.payment && booking.payment.status !== "PAID" ? "Diese Buchung kann derzeit nicht storniert werden. Bitte wende dich an den Veranstalter."
    : null;
  return {
    number: booking.number, quantity: booking.quantity, status: booking.status,
    eventName: booking.event.name, companyName: booking.event.company.name, beginsAt: booking.event.beginsAt?.toISOString() ?? null,
    deadline: policy.deadline?.toISOString() ?? null, free: policy.free, canCancel: !unavailableReason, unavailableReason,
    cancellation: latest ? { status: requestLabels[latest.status], refund: refundLabels[latest.refundStatus] } : null,
  };
}
