import { hasVoucher, reverseBookingVoucher, voucherHistory } from "@/lib/vouchers/reversal";
import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { MemberAccessError } from "@/lib/companies/members";
import { cancellationPolicy } from "./policy";
import { cancellationTransaction } from "./transaction";
import { queueCancellationMail } from "./mail";
import { managementTokenMatchesBooking, readBookingManagementToken } from "@/lib/bookings/management-token";

export class CancellationError extends Error {}
const idSchema = z.string().min(1).max(191);
const noteSchema = z.string().trim().max(2000).transform((s) => s || null);

export async function cancellationActor() {
  const session = await auth();
  if (!session?.user?.id) throw new MemberAccessError("UNAUTHENTICATED");
  return session.user.id;
}

export async function authorizeCancellation(tx: Prisma.TransactionClient, actor: string, booking: { userId: string | null; event: { companyId: string } }, companyManagement: boolean) {
  const user = await tx.user.findUnique({ where: { id: actor }, select: { role: true } });
  if (!user) throw new MemberAccessError("FORBIDDEN");
  if (!companyManagement && booking.userId === actor) return;
  if (!companyManagement) throw new MemberAccessError("FORBIDDEN");
  if (user.role === "ADMIN") return;
  const membership = await tx.companyMembership.findUnique({ where: { companyId_userId: { companyId: booking.event.companyId, userId: actor } } });
  if (membership?.status !== "ACTIVE" || !["COMPANY_ADMIN", "COMPANY_USER"].includes(membership.role)) throw new MemberAccessError("FORBIDDEN");
}

export function assertCancellable(booking: { status: string; payment: { status: string } | null; event: { beginsAt: Date | null } }, now: Date) {
  if (booking.status !== "CONFIRMED" || booking.payment && booking.payment.status !== "PAID") throw new CancellationError("Nur bestätigte, vollständig bezahlte Buchungen können storniert werden.");
  if (booking.event.beginsAt && booking.event.beginsAt <= now) throw new CancellationError("Das Event hat bereits begonnen. Eine Stornierung ist nicht mehr möglich.");
}

async function cancelBooking(tx: Prisma.TransactionClient, bookingId: string) {
  await tx.booking.update({ where: { id: bookingId }, data: { status: "CANCELLED" } });
  await tx.ticket.updateMany({ where: { bookingId }, data: { status: "CANCELLED" } });
}

export async function requestCancellation(bookingId: string, reason: string, expected: "free" | "request") {
  const actor = await cancellationActor();
  return createCancellationRequest(bookingId, reason, expected, async (tx, booking) => {
    await authorizeCancellation(tx, actor, booking, false);
    return actor;
  });
}

export async function requestCancellationWithToken(token: string, reason: string, expected: "free" | "request") {
  const payload = readBookingManagementToken(token);
  if (!payload) throw new CancellationError("Der Verwaltungslink ist ungültig oder nicht mehr verfügbar.");
  return createCancellationRequest(payload.bookingId, reason, expected, async (_tx, booking) => {
    if (!managementTokenMatchesBooking(payload, booking)) throw new CancellationError("Der Verwaltungslink ist ungültig oder nicht mehr verfügbar.");
    return null;
  });
}

async function createCancellationRequest(bookingId: string, reason: string, expected: "free" | "request", authorize: (
  tx: Prisma.TransactionClient, booking: { id: string; customerEmail: string | null; userId: string | null; event: { companyId: string } },
) => Promise<string | null>) {
  idSchema.parse(bookingId);
  const customerReason = noteSchema.parse(reason);
  z.enum(["free", "request"]).parse(expected);
  return cancellationTransaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: bookingId }, include: { ...voucherHistory, event: true, payment: true, cancellationRequests: { where: { status: { in: ["PENDING", "APPROVED"] } } } } });
    if (!booking) throw new MemberAccessError("NOT_FOUND");
    const actor = await authorize(tx, booking);
    // Idempotent replay returns the durable request instead of issuing another refund.
    if (booking.cancellationRequests.length) return booking.cancellationRequests[0];
    const now = new Date();
    assertCancellable(booking, now);
    const policy = cancellationPolicy(booking.event.beginsAt, booking.event.freeCancellationUntilMinutesBeforeStart, now);
    if (expected === "free" && !policy.free) throw new CancellationError("Die kostenfreie Frist ist abgelaufen. Bitte lade die Seite neu und stelle eine Stornierungsanfrage.");
    // Request intent must never silently turn into immediate cancellation.
    const automatic = expected === "free" && policy.free;
    const request = await tx.cancellationRequest.create({ data: {
      bookingId, customerReason, automatic, status: automatic ? "APPROVED" : "PENDING",
      decidedAt: automatic ? now : null, decidedById: automatic ? actor : null,
      refundStatus: automatic && booking.payment ? "PENDING" : "NONE",
    } });
    if (automatic) {
      if (hasVoucher(booking)) await reverseBookingVoucher(tx, booking.id, { cancellationRequestId: request.id });
      await cancelBooking(tx, booking.id);
    }
    await queueCancellationMail(tx, request.id, automatic ? "approved" : "requested");
    return request;
  });
}

export async function decideCancellation(requestId: string, decision: "APPROVED" | "REJECTED" | "WITHDRAWN", note = "") {
  idSchema.parse(requestId);
  const internalNote = noteSchema.parse(note);
  const actor = await cancellationActor();
  return cancellationTransaction(async (tx) => {
    const request = await tx.cancellationRequest.findUnique({ where: { id: requestId }, include: { booking: { include: { ...voucherHistory, event: true, payment: true } } } });
    if (!request) throw new MemberAccessError("NOT_FOUND");
    await authorizeCancellation(tx, actor, request.booking, decision !== "WITHDRAWN");
    if (request.status === decision) return requestId;
    if (request.status !== "PENDING") throw new CancellationError("Diese Anfrage wurde bereits entschieden oder zurückgezogen.");
    const now = new Date();
    if (decision === "APPROVED") assertCancellable(request.booking, now);
    const changed = await tx.cancellationRequest.updateMany({ where: { id: requestId, status: "PENDING" }, data: {
      status: decision, decidedAt: now, decidedById: actor,
      ...(decision !== "WITHDRAWN" ? { internalNote } : {}),
      refundStatus: decision === "APPROVED" && request.booking.payment ? "PENDING" : "NONE",
    } });
    if (!changed.count) throw new CancellationError("Diese Anfrage wurde bereits bearbeitet.");
    if (decision === "APPROVED") {
      if (hasVoucher(request.booking)) await reverseBookingVoucher(tx, request.bookingId, { cancellationRequestId: requestId });
      await cancelBooking(tx, request.bookingId);
    }
    if (decision !== "WITHDRAWN") await queueCancellationMail(tx, requestId, decision === "APPROVED" ? "approved" : "rejected");
    return requestId;
  });
}
