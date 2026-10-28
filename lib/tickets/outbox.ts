import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/db/prisma";
import { sendMail, type MailMessage } from "@/lib/mail";
import { encryptPaymentMail, decryptPaymentMail } from "@/lib/payments/mail";

export async function enqueueInitialTicketMail(tx: Prisma.TransactionClient, bookingId: string, message: MailMessage, paymentId?: string) {
  return tx.ticketMail.create({ data: { bookingId, paymentId, requestKey: `initial:${bookingId}`, encryptedMessage: encryptPaymentMail(message) } });
}

/** Lease + fencing token: another worker cannot claim a live job or finalize it. */
export async function deliverTicketMail(id: string) {
  const db = getPrisma();
  const now = new Date();
  const lockToken = randomUUID();
  const lock = await db.ticketMail.updateMany({
    where: { id, sentAt: null, availableAt: { lte: now }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    data: { lockToken, lockedUntil: new Date(now.getTime() + 5 * 60_000), attempts: { increment: 1 } },
  });
  if (!lock.count) return;
  let attempts = 1;
  try {
    const mail = await db.ticketMail.findFirst({ where: { id, lockToken, sentAt: null } });
    if (!mail?.encryptedMessage) throw new Error("Missing payload or lease");
    attempts = mail.attempts;
    await sendMail(decryptPaymentMail(mail.encryptedMessage));
    const saved = await db.ticketMail.updateMany({ where: { id, lockToken, sentAt: null },
      data: { sentAt: new Date(), encryptedMessage: null, lockedUntil: null, lockToken: null, lastError: null } });
    if (!saved.count) throw new Error("Lease lost");
  } catch {
    await db.ticketMail.updateMany({ where: { id, lockToken, sentAt: null }, data: {
      lockedUntil: null, lockToken: null, lastError: "DELIVERY_FAILED",
      availableAt: new Date(Date.now() + Math.min(3600, 30 * 2 ** Math.min(attempts - 1, 7)) * 1000),
    } });
    console.error("[tickets:outbox] Delivery failed", { id });
    throw new Error("Ticket mail delivery failed");
  }
}

export async function deliverPendingTicketMails() {
  const now = new Date();
  const mails = await getPrisma().ticketMail.findMany({ where: { sentAt: null, availableAt: { lte: now }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    select: { id: true }, take: 50, orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }] });
  let failures = 0;
  for (const mail of mails) { try { await deliverTicketMail(mail.id); } catch { failures++; } }
  return { checked: mails.length, failures };
}
