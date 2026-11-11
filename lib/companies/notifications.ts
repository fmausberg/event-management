import "server-only";
import type { Prisma } from "@prisma/client";
import { escapeHtml } from "@/lib/mail/templates/footer";
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
  const booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { event: { include: { company: { select: { slug: true } } } }, user: { select: { name: true, email: true } } } });
  const companyPath = `/company/${encodeURIComponent(booking.event.company.slug)}`;
  const baseUrl = process.env.AUTH_URL ?? "http://localhost:3000";
  const eventUrl = new URL(`${companyPath}/events/${encodeURIComponent(booking.event.id)}`, baseUrl).toString();
  const bookingUrl = new URL(`${companyPath}/bookings`, baseUrl);
  bookingUrl.searchParams.set("booking", bookingId);
  const customerName = booking.customerName ?? booking.user?.name ?? "Nicht angegeben";
  const customerEmail = booking.customerEmail ?? booking.user?.email ?? "Nicht angegeben";
  for (const to of await companyRecipients(tx, booking.event.companyId, "notifyBookings")) {
    const message: CompanyMessage = {
      to, subject: `Neue Buchung #${booking.number}`,
      text: `Neue Buchung #${booking.number}
Buchung: ${bookingUrl}
Event: ${booking.event.name}
Event verwalten: ${eventUrl}
Name: ${customerName}
E-Mail: ${customerEmail}
Anzahl: ${booking.quantity}`,
      html: `<div style="max-width:600px;margin:auto;font-family:Arial,sans-serif;line-height:1.6"><h1>Neue Buchung <a href="${escapeHtml(bookingUrl.toString())}">#${booking.number}</a></h1><p>Event: <a href="${escapeHtml(eventUrl)}">${escapeHtml(booking.event.name)}</a><br>Name: ${escapeHtml(customerName)}<br>E-Mail: ${escapeHtml(customerEmail)}<br>Anzahl: ${booking.quantity}</p></div>`,
      companyNotification: { companyId: booking.event.companyId, type: "notifyBookings" },
    };
    const requestKey = `company-booking:${bookingId}:${to}`;
    await tx.mailOutbox.upsert({ where: { requestKey }, create: {
      requestKey, kind: "COMPANY_NOTIFICATION", encryptedMessage: encryptPaymentMail(message),
    }, update: {} });
  }
}
