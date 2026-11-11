import "server-only";
import type { Prisma } from "@prisma/client";
import type { MailMessage } from "@/lib/mail";
import { encryptPaymentMail } from "@/lib/payments/mail";

export type NotificationType = "notifyBookings" | "notifyCancellationRequests";
export type CompanyMessage = MailMessage & {
  companyNotification?: { companyId: string; type: NotificationType };
  customerNotification?: boolean;
};

export async function companyRecipients(tx: Prisma.TransactionClient, companyId: string, type: NotificationType) {
  const members = await tx.companyMembership.findMany({
    where: { companyId, status: "ACTIVE", [type]: true, user: { is: { emailVerified: { not: null } } } },
    select: { user: { select: { email: true } } },
  });
  return [...new Set(members.flatMap(({ user }) => user ? [user.email.trim().toLowerCase()] : []))];
}

export async function mayDeliverCompanyMessage(tx: Prisma.TransactionClient, message: CompanyMessage) {
  const context = message.companyNotification;
  if (!context) return false;
  if (context.type !== "notifyBookings" && context.type !== "notifyCancellationRequests") return false;
  return (await companyRecipients(tx, context.companyId, context.type)).includes(message.to.trim().toLowerCase());
}

export async function queueBookingNotification(tx: Prisma.TransactionClient, bookingId: string) {
  const booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { event: true } });
  for (const to of await companyRecipients(tx, booking.event.companyId, "notifyBookings")) {
    const message: CompanyMessage = {
      to, subject: `Neue Buchung #${booking.number}`,
      text: `Neue Buchung #${booking.number}\nEvent: ${booking.event.name}\nAnzahl: ${booking.quantity}\n\nDetails findest du in der Company-Verwaltung unter Buchungen.`,
      companyNotification: { companyId: booking.event.companyId, type: "notifyBookings" },
    };
    const requestKey = `company-booking:${bookingId}:${to}`;
    await tx.mailOutbox.upsert({ where: { requestKey }, create: {
      requestKey, kind: "COMPANY_NOTIFICATION", encryptedMessage: encryptPaymentMail(message),
    }, update: {} });
  }
}
