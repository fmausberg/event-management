import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { getPrisma } from "@/lib/db/prisma";
import { accountOrigin } from "@/lib/auth/verification";
import { encryptPaymentMail } from "@/lib/payments/mail";
import { deliverEncryptedMail } from "@/lib/tickets/outbox";
import { eventReviewMessage } from "@/lib/mail/templates/event-review";
import { hashReviewToken } from "./token";
import { REVIEW_LIFETIME_MS } from "./validation";

export async function enqueueDueReviews(now = new Date()) {
  const db = getPrisma();
  // Exclude normalized recipients already invited across ALL bookings, not just
  // the anchor booking. This also prevents duplicate group bookings starving batches.
  let queued = 0;
  let failures = 0;
  let checked = 0;
  let cursor = "";
  while (queued < 50) {
    const candidates = await db.$queryRaw<{ id: string }[]>`
      SELECT candidate.id FROM (
      SELECT DISTINCT ON (b."eventId", lower(trim(coalesce(b."customerEmail", u.email)))) b.id
      FROM "Booking" b JOIN "Event" e ON e.id = b."eventId"
      LEFT JOIN "User" u ON u.id = b."userId"
      WHERE e."End" <= ${now} AND e.status IN ('PUBLISHED', 'COMPLETED')
        AND coalesce(b."customerEmail", u.email) IS NOT NULL
        AND trim(coalesce(b."customerEmail", u.email)) <> ''
        AND EXISTS (SELECT 1 FROM "Ticket" t WHERE t."bookingId" = b.id AND t."checkedInAt" IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM "EventReview" r WHERE r."eventId" = b."eventId"
          AND r."recipientEmail" = lower(trim(coalesce(b."customerEmail", u.email))))
      ORDER BY b."eventId", lower(trim(coalesce(b."customerEmail", u.email))), b.id
      ) candidate WHERE candidate.id > ${cursor} ORDER BY candidate.id LIMIT 50`;
    if (!candidates.length) break;
    // Invalid legacy email addresses must not starve later eligible participants.
    for (const candidate of candidates) {
      cursor = candidate.id;
      checked++;
      try {
        queued += await db.$transaction(async tx => {
          const booking = await tx.booking.findUnique({ where: { id: candidate.id }, include: {
            user: { select: { email: true } }, event: true,
            tickets: { where: { checkedInAt: { not: null } }, orderBy: { id: "asc" }, take: 1 },
          } });
          if (!booking?.tickets.length || !booking.event.endsAt || booking.event.endsAt > now || !["PUBLISHED", "COMPLETED"].includes(booking.event.status)) return 0;
          const recipientEmail = (booking.customerEmail ?? booking.user?.email ?? "").trim().toLowerCase();
          if (!z.email().safeParse(recipientEmail).success) return 0;
          if (await tx.eventReview.findUnique({ where: { eventId_recipientEmail: { eventId: booking.eventId, recipientEmail } } })) return 0;
          const token = randomBytes(32).toString("base64url");
          const review = await tx.eventReview.create({ data: {
            eventId: booking.eventId, bookingId: booking.id, ticketId: booking.tickets[0].id,
            recipientEmail, tokenHash: hashReviewToken(token), expiresAt: new Date(now.getTime() + REVIEW_LIFETIME_MS),
          } });
          await tx.mailOutbox.create({ data: { kind: "EVENT_REVIEW", reviewId: review.id,
            requestKey: `event-review:${review.id}`,
            encryptedMessage: encryptPaymentMail({ to: recipientEmail, ...eventReviewMessage(booking.event.name, accountOrigin(), token) }),
          } });
          return 1;
        }, { isolationLevel: "Serializable" });
      } catch {
        failures++;
        console.error("[reviews] Invitation enqueue failed");
      }
      if (queued >= 50) break;
    }
  }
  return { checked, queued, failures };
}

export async function deliverPendingReviews() {
  const now = new Date();
  const mails = await getPrisma().mailOutbox.findMany({ where: {
    kind: "EVENT_REVIEW", sentAt: null, cancelledAt: null, availableAt: { lte: now },
    OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
  }, select: { id: true }, take: 50, orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }] });
  let delivered = 0;
  let failures = 0;
  for (const mail of mails) {
    try { if (await deliverEncryptedMail(mail.id, "review")) delivered++; } catch { failures++; }
  }
  return { checked: mails.length, delivered, failures };
}
