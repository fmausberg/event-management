import "server-only";
import { companyRecipients, mayDeliverCompanyMessage, type CompanyMessage } from "@/lib/companies/notifications";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/db/prisma";
import { sendMail } from "@/lib/mail";
import { encryptPaymentMail, decryptPaymentMail } from "@/lib/payments/mail";

type Notice = "requested" | "approved" | "rejected" | "refunded" | "failed";
const internalStatus: Record<Notice, string> = {
  requested: "Neue Stornierungsanfrage",
  approved: "Stornierung genehmigt",
  rejected: "Stornierungsanfrage abgelehnt",
  refunded: "Rückerstattung bestätigt",
  failed: "Rückerstattung fehlgeschlagen oder Prüfung erforderlich",
};
const messages: Record<Notice, string> = {
  requested: "Eine neue Stornierungsanfrage wartet auf Entscheidung in der Company-Verwaltung. Buchung und Tickets bleiben bis zur Genehmigung gültig.",
  approved: "Deine Stornierung wurde genehmigt. Buchung und Tickets sind storniert. Falls eine Onlinezahlung vorliegt, wird die vollständige Rückerstattung bearbeitet; ihr Abschluss wird gesondert bestätigt.",
  rejected: "Deine Stornierungsanfrage wurde abgelehnt. Deine Buchung und Tickets bleiben unverändert. Es erfolgt keine Rückerstattung.",
  refunded: "Stripe hat die vollständige Rückerstattung bestätigt. Die Gutschrift auf deinem Zahlungsmittel kann noch einige Bankarbeitstage dauern.",
  failed: "Die Rückerstattung ist fehlgeschlagen oder muss geprüft werden. Deine Buchung bleibt storniert. Der Veranstalter kann den Vorgang in der Company-Verwaltung prüfen und sicher wiederaufnehmen. Bitte buche nicht erneut, um eine Erstattung auszulösen.",
};

export async function queueCancellationMail(tx: Prisma.TransactionClient, requestId: string, kind: Notice) {
  const request = await tx.cancellationRequest.findUniqueOrThrow({ where: { id: requestId }, include: { booking: { include: { user: true, event: { include: { company: true } } } } } });
  const { booking } = request;
  const customerEmail = kind !== "requested" ? booking.user?.email ?? booking.customerEmail : null;
  const recipients = await companyRecipients(tx, booking.event.companyId, "notifyCancellationRequests");
  if (customerEmail) recipients.push(customerEmail.trim().toLowerCase());
  if (!recipients.length) console.error("Cancellation notification has no recipient", { requestId, kind });
  for (const to of new Set(recipients)) {
    const id = createHash("sha256").update(`${requestId}:${kind}:${request.refundAttempt}:${to.toLowerCase()}`).digest("hex");
    const message: CompanyMessage = {
      ...(to === customerEmail?.trim().toLowerCase() ? { customerNotification: true } : { companyNotification: { companyId: booking.event.companyId, type: "notifyCancellationRequests" as const } }),
      to, subject: `Stornierung – Buchung #${booking.number}`, text: `Hallo,\n\n${to === customerEmail?.trim().toLowerCase() ? messages[kind] : `Interne Stornierungsbenachrichtigung: ${internalStatus[kind]}. Bitte den Vorgang in der Company-Verwaltung unter Stornierungen pr\u00fcfen.`}\n\nBuchung: #${booking.number}\nEvent: ${booking.event.name}\nVeranstalter: ${booking.event.company.name}\n\nDen aktuellen Stand findest du über den Link „Buchung verwalten / stornieren“ aus deiner Buchungsbestätigung (ohne Anmeldung), in deinem Konto unter „Meine Buchungen“ oder in der Company-Verwaltung unter „Stornierungen“.\n\nDein Event-Management-Team` };
    await tx.cancellationMail.upsert({ where: { id }, create: { id, requestId, encryptedMessage: encryptPaymentMail(message) }, update: {} });
  }
}

export async function deliverCancellationMails() {
  const db = getPrisma();
  const mails = await db.cancellationMail.findMany({ where: { sentAt: null, OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }] }, take: 50, orderBy: { createdAt: "asc" } });
  let failures = 0;
  for (const mail of mails) {
    const lockedUntil = new Date(Date.now() + 300_000);
    const lock = await db.cancellationMail.updateMany({ where: { id: mail.id, sentAt: null, OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }] }, data: { lockedUntil } });
    if (!lock.count) continue;
    try {
      if (!mail.encryptedMessage) throw new Error("Missing notification");
      const message: CompanyMessage = decryptPaymentMail(mail.encryptedMessage);
      // Legacy queued messages have no audience marker. Preserve customer delivery;
      // all other recipients must pass the current Company checks as well.
      if (!message.companyNotification && !message.customerNotification) {
        const request = await db.cancellationRequest.findUniqueOrThrow({ where: { id: mail.requestId }, include: { booking: { include: { user: true, event: true } } } });
        const customer = request.booking.user?.email ?? request.booking.customerEmail;
        const requestedId = createHash("sha256").update(`${mail.requestId}:requested:0:${message.to.toLowerCase()}`).digest("hex");
        if (mail.id === requestedId || message.to.trim().toLowerCase() !== customer?.trim().toLowerCase()) {
          message.companyNotification = { companyId: request.booking.event.companyId, type: "notifyCancellationRequests" };
        }
      }
      if (!message.companyNotification || await mayDeliverCompanyMessage(db, message)) {
        const { companyNotification: _context, customerNotification: _customer, ...payload } = message;
        await sendMail(payload);
      }
      await db.cancellationMail.update({ where: { id: mail.id }, data: { sentAt: new Date(), encryptedMessage: null, lockedUntil: null } });
    } catch {
      failures++;
      console.error("Cancellation mail delivery failed", { mailId: mail.id });
      // Back off and rotate failed messages so they cannot starve later mail.
      await db.cancellationMail.updateMany({ where: { id: mail.id, lockedUntil }, data: { lockedUntil: new Date(Date.now() + 300_000), createdAt: new Date() } });
    }
  }
  return failures;
}
