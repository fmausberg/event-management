import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/db/prisma";
import { sendMail } from "@/lib/mail";
import { trainerReminderMessage } from "@/lib/mail/templates/trainer-reminder";
import { accountOrigin } from "@/lib/auth/verification";

const WINDOW_MS = 60 * 60_000;
const LEASE_MS = 5 * 60_000;
const BATCH_SIZE = 50;

function dueWhere(now: Date) {
  return {
    status: "PUBLISHED" as const,
    trainerReminderSentAt: null,
    beginsAt: { gt: now, lte: new Date(now.getTime() + WINDOW_MS) },
    trainers: { some: {} },
  };
}

/** Atomically creates one stable reminder and one deduplicated delivery per current trainer. */
export async function enqueueDueTrainerReminders(now = new Date()) {
  const db = getPrisma();
  const due = await db.event.findMany({
    where: dueWhere(now),
    select: { id: true },
    orderBy: [{ beginsAt: "asc" }, { id: "asc" }],
    take: BATCH_SIZE,
  });
  let queued = 0;
  let failures = 0;
  for (const candidate of due) {
    try {
      queued += await db.$transaction(async (tx) => {
        const event = await tx.event.findFirst({
          where: { id: candidate.id, ...dueWhere(now) },
          select: { id: true, trainers: { select: { trainerId: true } } },
        });
        if (!event?.trainers.length) return 0;
        const requestKey = `trainer-reminder:auto:${event.id}`;
        const reminder = await tx.trainerReminder.upsert({
          where: { requestKey },
          create: { eventId: event.id, requestKey },
          update: {},
          select: { id: true },
        });
        const trainerIds = event.trainers.map(({ trainerId }) => trainerId);
        const created = await tx.mailOutbox.createMany({
          data: trainerIds.map((trainerId) => ({
            kind: "TRAINER_REMINDER" as const,
            trainerReminderId: reminder.id,
            trainerId,
            requestKey: `trainer-reminder:auto:${event.id}:${trainerId}`,
          })),
          skipDuplicates: true,
        });
        // A removed and later restored assignment reuses its original stable job.
        await tx.mailOutbox.updateMany({
          where: { trainerReminderId: reminder.id, trainerId: { in: trainerIds }, sentAt: null, cancelledAt: { not: null } },
          data: { cancelledAt: null, availableAt: now, lastError: null },
        });
        return created.count;
      });
    } catch {
      failures++;
      console.error("[trainer-reminder:enqueue] Event failed", { eventId: candidate.id });
    }
  }
  return { checked: due.length, queued, failures };
}

async function cancelUnavailableMail(id: string, lockToken: string, reason: string) {
  await getPrisma().mailOutbox.updateMany({
    where: { id, lockToken, sentAt: null },
    data: { cancelledAt: new Date(), lockedUntil: null, lockToken: null, lastError: reason },
  });
}

async function finalizeDelivery(id: string, reminderId: string, lockToken: string) {
  const db = getPrisma();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await db.$transaction(async (tx) => {
        const sentAt = new Date();
        const saved = await tx.mailOutbox.updateMany({
          where: { id, lockToken, sentAt: null },
          data: { sentAt, cancelledAt: null, lockedUntil: null, lockToken: null, lastError: null },
        });
        if (!saved.count) throw new Error("Lease lost");
        const reminder = await tx.trainerReminder.findUnique({
          where: { id: reminderId },
          select: {
            manualRequestedAt: true,
            event: {
              select: { id: true, status: true, beginsAt: true, trainerReminderSentAt: true, trainers: { select: { trainerId: true } } },
            },
          },
        });
        const event = reminder?.event;
        const manual = !!reminder?.manualRequestedAt;
        if (!event || event.status !== "PUBLISHED" || (!manual && event.trainerReminderSentAt) || !event.beginsAt
          || event.beginsAt <= sentAt || (!manual && event.beginsAt > new Date(sentAt.getTime() + WINDOW_MS)) || !event.trainers.length) return;
        const trainerIds = event.trainers.map(({ trainerId }) => trainerId);
        const accepted = await tx.mailOutbox.count({
          where: { trainerReminderId: reminderId, kind: "TRAINER_REMINDER", trainerId: { in: trainerIds }, sentAt: { not: null } },
        });
        if (accepted === trainerIds.length) await tx.event.updateMany({
          where: { id: event.id, status: "PUBLISHED", ...(!manual ? { trainerReminderSentAt: null } : {}) },
          data: { trainerReminderSentAt: sentAt },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && attempt < 2) continue;
      throw error;
    }
  }
}

async function finalizeReminderIfComplete(reminderId: string) {
  const db = getPrisma();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await db.$transaction(async (tx) => {
        const now = new Date();
        const reminder = await tx.trainerReminder.findUnique({
          where: { id: reminderId },
          select: { manualRequestedAt: true, event: { select: {
            id: true, status: true, beginsAt: true, trainerReminderSentAt: true,
            trainers: { select: { trainerId: true } },
          } } },
        });
        const event = reminder?.event;
        const manual = !!reminder?.manualRequestedAt;
        if (!event || event.status !== "PUBLISHED" || (!manual && event.trainerReminderSentAt) || !event.beginsAt
          || event.beginsAt <= now || (!manual && event.beginsAt > new Date(now.getTime() + WINDOW_MS)) || !event.trainers.length) return;
        const trainerIds = event.trainers.map(({ trainerId }) => trainerId);
        const accepted = await tx.mailOutbox.count({
          where: { trainerReminderId: reminderId, kind: "TRAINER_REMINDER", trainerId: { in: trainerIds }, sentAt: { not: null } },
        });
        if (accepted === trainerIds.length) await tx.event.updateMany({
          where: { id: event.id, status: "PUBLISHED", ...(!manual ? { trainerReminderSentAt: null } : {}) },
          data: { trainerReminderSentAt: now },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      return;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && attempt < 2) continue;
      throw error;
    }
  }
}

/** Lease + fencing token; the message is built from current data immediately before SMTP. */
export async function deliverTrainerReminderMail(id: string) {
  const db = getPrisma();
  const now = new Date();
  const lockToken = randomUUID();
  const lock = await db.mailOutbox.updateMany({
    where: {
      id, kind: "TRAINER_REMINDER", sentAt: null, cancelledAt: null, availableAt: { lte: now },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
    data: { lockToken, lockedUntil: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 } },
  });
  if (!lock.count) return false;
  let attempts = 1;
  try {
    const mail = await db.mailOutbox.findFirst({
      where: { id, lockToken, sentAt: null, cancelledAt: null },
      select: {
        attempts: true, trainerReminderId: true,
        trainer: { select: { id: true, firstName: true, lastName: true, email: true } },
        trainerReminder: { select: { manualRequestedAt: true, event: { select: {
          id: true, name: true, status: true, beginsAt: true, trainerReminderSentAt: true,
          company: { select: { slug: true } },
          venue: { select: { name: true, addressLine1: true, addressLine2: true, postalCode: true, city: true } },
          trainers: { select: { trainerId: true } },
        } } } },
      },
    });
    if (!mail) throw new Error("Missing job or lease");
    attempts = mail.attempts;
    if (!mail.trainer || !mail.trainerReminderId || !mail.trainerReminder) {
      await cancelUnavailableMail(id, lockToken, "MISSING_REFERENCE");
      return false;
    }
    const trainer = mail.trainer;
    const event = mail.trainerReminder.event;
    const manual = !!mail.trainerReminder.manualRequestedAt;
    const eventEligible = event.status === "PUBLISHED" && (manual || !event.trainerReminderSentAt) && event.beginsAt
      && event.beginsAt > now && (manual || event.beginsAt <= new Date(now.getTime() + WINDOW_MS));
    const assigned = event.trainers.some(({ trainerId }) => trainerId === trainer.id);
    const eligible = eventEligible && assigned;
    if (!eligible || !event.beginsAt) {
      await cancelUnavailableMail(id, lockToken, "NO_LONGER_ELIGIBLE");
      if (eventEligible && !assigned) await finalizeReminderIfComplete(mail.trainerReminderId);
      return false;
    }
    const confirmed = await db.booking.aggregate({
      where: { eventId: event.id, status: "CONFIRMED" },
      _sum: { quantity: true },
    });
    const venue = event.venue;
    const venueText = venue
      ? [venue.name, venue.addressLine1, venue.addressLine2, [venue.postalCode, venue.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")
      : null;
    const participantsUrl = `${accountOrigin()}/company/${encodeURIComponent(event.company.slug)}/events/${encodeURIComponent(event.id)}/tickets`;
    await sendMail({
      to: trainer.email,
      ...trainerReminderMessage({
        trainerName: [trainer.firstName, trainer.lastName].filter(Boolean).join(" "),
        eventName: event.name,
        beginsAt: event.beginsAt,
        venue: venueText,
        confirmedSeats: confirmed._sum.quantity ?? 0,
        participantsUrl,
      }),
    });
    await finalizeDelivery(id, mail.trainerReminderId, lockToken);
    return true;
  } catch {
    await db.mailOutbox.updateMany({
      where: { id, lockToken, sentAt: null },
      data: {
        lockedUntil: null, lockToken: null, lastError: "DELIVERY_FAILED",
        availableAt: new Date(Date.now() + Math.min(3600, 30 * 2 ** Math.min(attempts - 1, 7)) * 1000),
      },
    });
    console.error("[trainer-reminder:outbox] Delivery failed", { id });
    throw new Error("Trainer reminder delivery failed");
  }
}

/** Requests the existing reminder immediately; retries keep using the same stable jobs. */
export async function requestTrainerReminderNow(eventId: string, companyId: string, requestId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw new Error("Invalid request id");
  const db = getPrisma();
  const now = new Date();
  const queued = await db.$transaction(async (tx) => {
    const event = await tx.event.findFirst({
      where: {
        id: eventId, companyId, status: "PUBLISHED",
        beginsAt: { gt: now }, trainers: { some: {} },
      },
      select: { id: true, trainers: { select: { trainerId: true } } },
    });
    if (!event?.trainers.length) return null;
    const requestKey = `trainer-reminder:manual:${event.id}:${requestId}`;
    const reminder = await tx.trainerReminder.upsert({
      where: { requestKey },
      create: { eventId: event.id, requestKey, manualRequestedAt: now },
      update: { manualRequestedAt: now },
      select: { id: true },
    });
    const trainerIds = event.trainers.map(({ trainerId }) => trainerId);
    await tx.mailOutbox.createMany({
      data: trainerIds.map((trainerId) => ({
        kind: "TRAINER_REMINDER" as const,
        trainerReminderId: reminder.id,
        trainerId,
        requestKey: `trainer-reminder:manual:${event.id}:${requestId}:${trainerId}`,
      })),
      skipDuplicates: true,
    });
    await tx.mailOutbox.updateMany({
      where: { trainerReminderId: reminder.id, trainerId: { in: trainerIds }, sentAt: null, cancelledAt: { not: null } },
      data: { cancelledAt: null, availableAt: now, lastError: null },
    });
    const mails = await tx.mailOutbox.findMany({
      where: { trainerReminderId: reminder.id, trainerId: { in: trainerIds }, sentAt: null, cancelledAt: null },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    return { reminderId: reminder.id, mailIds: mails.map(({ id }) => id) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if (!queued) return { available: false, delivered: 0, failures: 0, sent: false, sentAt: null };
  let delivered = 0;
  let failures = 0;
  for (const id of queued.mailIds) {
    try { if (await deliverTrainerReminderMail(id)) delivered++; } catch { failures++; }
  }
  await finalizeReminderIfComplete(queued.reminderId);
  const event = await db.event.findUnique({ where: { id: eventId }, select: { trainerReminderSentAt: true } });
  return { available: true, delivered, failures, sent: !!event?.trainerReminderSentAt, sentAt: event?.trainerReminderSentAt?.toISOString() ?? null };
}

export async function deliverPendingTrainerReminders() {
  const now = new Date();
  const mails = await getPrisma().mailOutbox.findMany({
    where: {
      kind: "TRAINER_REMINDER", sentAt: null, cancelledAt: null, availableAt: { lte: now },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
    select: { id: true },
    take: BATCH_SIZE,
    orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
  });
  let failures = 0;
  let delivered = 0;
  for (const mail of mails) {
    try { if (await deliverTrainerReminderMail(mail.id)) delivered++; } catch { failures++; }
  }
  return { checked: mails.length, delivered, failures };
}
