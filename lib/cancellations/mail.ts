import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/db/prisma";
import { sendMail } from "@/lib/mail";
import { encryptPaymentMail, decryptPaymentMail } from "@/lib/payments/mail";

type Notice = "requested" | "approved" | "rejected" | "refunded" | "failed";
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
  let recipients: string[] = [];
  if (kind === "requested" || kind === "failed") {
    const admins = await tx.companyMembership.findMany({ where: { companyId: booking.event.companyId, role: "COMPANY_ADMIN", status: "ACTIVE" }, include: { user: true } });
    recipients = admins.flatMap((admin) => admin.user?.email ? [admin.user.email] : []);
  }
  if (kind !== "requested") {
    const email = booking.user?.email ?? booking.customerEmail;
    if (email) recipients.push(email);
  }
  if (!recipients.length) console.error("Cancellation notification has no recipient", { requestId, kind });
  for (const to of new Set(recipients)) {
    const id = createHash("sha256").update(`${requestId}:${kind}:${request.refundAttempt}:${to.toLowerCase()}`).digest("hex");
    const message = { to, subject: `Stornierung – Buchung #${booking.number}`, text: `Hallo,\n\n${messages[kind]}\n\nBuchung: #${booking.number}\nEvent: ${booking.event.name}\nVeranstalter: ${booking.event.company.name}\n\nDen aktuellen Stand findest du in deinem Konto unter „Meine Buchungen“ bzw. in der Company-Verwaltung unter „Stornierungen“.\n\nDein Event-Management-Team` };
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
      await sendMail(decryptPaymentMail(mail.encryptedMessage));
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
