import { queueBookingNotification } from "@/lib/companies/notifications";
import { voucherHistory, hasVoucher } from "@/lib/vouchers/reversal";
import { Platform, Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/db/prisma";

export interface UpsertExternalBookingInput {
  eventId: string;
  platform: Platform;
  externalBookingId: string;
  quantity: number;
  status: "CONFIRMED" | "CANCELLED";
  bookedAt: Date;
  customerName?: string | null;
  customerEmail?: string | null;
}

function validate(input: UpsertExternalBookingInput) {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0 || input.quantity > 2_147_483_647) {
    throw new Error("quantity must be a positive PostgreSQL integer.");
  }
  if (!input.eventId.trim() || !input.externalBookingId.trim()) {
    throw new Error("eventId and externalBookingId must not be empty.");
  }
  if (!Object.values(Platform).includes(input.platform) || !["CONFIRMED", "CANCELLED"].includes(input.status)) {
    throw new Error("Unsupported platform or booking status.");
  }
  if (!(input.bookedAt instanceof Date) || !Number.isFinite(input.bookedAt.getTime())) {
    throw new Error("bookedAt must be a valid Date.");
  }
  if (input.customerName != null && (typeof input.customerName !== "string" || input.customerName.length > 160)) throw new Error("Invalid external customer name.");
  if (input.customerEmail != null && (typeof input.customerEmail !== "string" || input.customerEmail.length > 254)) throw new Error("Invalid external customer email.");
}

/** Allows a complete provider snapshot to commit atomically in its caller's transaction. */
export async function upsertExternalBookingInTransaction(tx: Prisma.TransactionClient, input: UpsertExternalBookingInput, options: { notifyCompany?: boolean; requireNoTickets?: boolean } = {}) {
  validate(input);
  const { eventId, platform, externalBookingId, quantity, status, bookedAt, customerName, customerEmail } = input;
  const contact = { ...(customerName === undefined ? {} : { customerName }), ...(customerEmail === undefined ? {} : { customerEmail }) };
  const existing = await tx.booking.findUnique({ where: { platform_externalBookingId: { platform, externalBookingId } }, select: { id: true } });
  // One unique key drives both insert and update, including cancellation/reinstatement.
  const booking = await tx.booking.upsert({
    where: { platform_externalBookingId: { platform, externalBookingId } },
    create: { eventId, platform, externalBookingId, quantity, status, bookedAt, ...contact },
    update: { quantity, status, bookedAt, ...contact },
    include: { ...voucherHistory, payment: true, ...(options.requireNoTickets ? { tickets: { select: { id: true }, take: 1 } } : {}), cancellationRequests: { where: { status: { in: ["PENDING", "APPROVED"] } }, select: { id: true } } },
  });
  if (booking.price || booking.payment || hasVoucher(booking)) throw new Error("External update blocked by financial booking history.");
  if (booking.cancellationRequests?.length) throw new Error("External booking has an active cancellation workflow.");
  if (options.requireNoTickets && booking.tickets?.length) throw new Error("External booking has locally issued tickets.");
  if (booking.eventId !== eventId) {
    // Throw inside the transaction so even the update above is rolled back.
    throw new Error("External booking already belongs to another event.");
  }
  if (!existing && status === "CONFIRMED" && options.notifyCompany !== false) await queueBookingNotification(tx, booking.id);
  return booking;
}

export async function upsertExternalBooking(input: UpsertExternalBookingInput) {
  validate(input);
  return getPrisma().$transaction(tx => upsertExternalBookingInTransaction(tx, input), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
