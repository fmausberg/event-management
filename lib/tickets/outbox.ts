import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/db/prisma";
import { sendMail, type MailMessage } from "@/lib/mail";
import { encryptPaymentMail, decryptPaymentMail } from "@/lib/payments/mail";

type DeliveryWhere = {
  id: string; sentAt: null; lockToken?: string; availableAt?: { lte: Date };
  OR?: ({ lockedUntil: null } | { lockedUntil: { lt: Date } })[];
};
function deliveryStore(tx: Prisma.TransactionClient, kind: "ticket" | "review") {
  return {
    updateMany: (args: { where: DeliveryWhere; data: Prisma.TicketMailUpdateManyMutationInput }) => kind === "ticket"
      ? tx.ticketMail.updateMany(args)
      : tx.mailOutbox.updateMany({ ...args, where: { ...args.where, kind: "EVENT_REVIEW", cancelledAt: null } }),
    findFirst: (args: { where: DeliveryWhere }) => kind === "ticket"
      ? tx.ticketMail.findFirst(args)
      : tx.mailOutbox.findFirst({ where: { ...args.where, kind: "EVENT_REVIEW", cancelledAt: null } }),
  };
}

export async function enqueueInitialTicketMail(tx: Prisma.TransactionClient, bookingId: string, message: MailMessage, paymentId?: string) {
  return tx.ticketMail.create({ data: { bookingId, paymentId, requestKey: `initial:${bookingId}`, encryptedMessage: encryptPaymentMail(message) } });
}

/** Lease + fencing token: another worker cannot claim a live job or finalize it. */
export async function deliverTicketMail(id: string) {
  return deliverEncryptedMail(id, "ticket");
}

/** Shared encrypted-payload delivery, retry and fencing for tickets and reviews. */
export async function deliverEncryptedMail(id: string, kind: "ticket" | "review") {
  const db = getPrisma();
  const outbox = deliveryStore(db, kind);
  const now = new Date();
  const lockToken = randomUUID();
  const lock = await outbox.updateMany({
    where: { id, sentAt: null, availableAt: { lte: now }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    data: { lockToken, lockedUntil: new Date(now.getTime() + 5 * 60_000), attempts: { increment: 1 } },
  });
  if (!lock.count) return false;
  let attempts = 1;
  try {
    const mail = await outbox.findFirst({ where: { id, lockToken, sentAt: null } });
    if (!mail?.encryptedMessage) throw new Error("Missing payload or lease");
    attempts = mail.attempts;
    if (kind === "review") {
      const review = await db.eventReview.findFirst({ where: { mail: { is: { id } } }, include: { event: true, ticket: true } });
      if (!review || review.expiresAt <= now || review.submittedAt) {
        await db.mailOutbox.updateMany({ where: { id, lockToken, sentAt: null }, data: { cancelledAt: now, encryptedMessage: null, lockToken: null, lockedUntil: null } });
        return false;
      }
      if (!review.event.endsAt || review.event.endsAt > now || !["PUBLISHED", "COMPLETED"].includes(review.event.status) || !review.ticket.checkedInAt) throw new Error("Not eligible");
    }
    await sendMail(decryptPaymentMail(mail.encryptedMessage));
    const finalize = async (tx: Prisma.TransactionClient) => {
      const sentAt = new Date();
      const target = deliveryStore(tx, kind);
      const saved = await target.updateMany({ where: { id, lockToken, sentAt: null },
        data: { sentAt, encryptedMessage: null, lockedUntil: null, lockToken: null, lastError: null } });
      if (!saved.count) throw new Error("Lease lost");
      if (kind === "review") await tx.eventReview.updateMany({ where: { mail: { is: { id } } }, data: { sentAt } });
    };
    if (kind === "review") await db.$transaction(finalize);
    else await finalize(db);
    return true;
  } catch {
    await outbox.updateMany({ where: { id, lockToken, sentAt: null }, data: {
      lockedUntil: null, lockToken: null, lastError: "DELIVERY_FAILED",
      availableAt: new Date(Date.now() + Math.min(3600, 30 * 2 ** Math.min(attempts - 1, 7)) * 1000),
    } });
    console.error(kind === "ticket" ? "[tickets:outbox] Delivery failed" : "[reviews:outbox] Delivery failed", { id });
    throw new Error(kind === "ticket" ? "Ticket mail delivery failed" : "Review mail delivery failed");
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
