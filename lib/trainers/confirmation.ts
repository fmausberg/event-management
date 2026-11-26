import "server-only";

import { Prisma } from "@prisma/client";

import { z } from "zod";

import { getPrisma } from "@/lib/db/prisma";

import { accountOrigin } from "@/lib/auth/verification";

import { companyRecipients, type CompanyMessage } from "@/lib/companies/notifications";

import { encryptPaymentMail } from "@/lib/payments/mail";

import { trainerBatchConfirmationMessage, trainerConfirmationMessage, trainerIssueMessage } from "@/lib/mail/templates/trainer-confirmation";

import { ensureVenueApproval, synchronizeVenueConfirmation } from "@/lib/venues/confirmation";



export class TrainerConfirmationError extends Error {}

export const trainerIssueSchema = z.string().trim().min(1, "Bitte gib einen Grund ein.").max(20000, "Bitte verwende höchstens 20000 Zeichen.");

const eventInclude = { company: true, venue: true, trainers: { include: { trainer: true } } } as const;

function facts(event: Prisma.EventGetPayload<{ include: typeof eventInclude }>) {

  const venue = event.venue;

  return { name: event.name, beginsAt: event.beginsAt, endsAt: event.endsAt, company: event.company.name,

    venue: venue ? [venue.name, venue.addressLine1, venue.addressLine2, [venue.postalCode, venue.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "Noch offen" };

}



/** Call after all event/assignment writes, within the same serializable transaction. */

export async function synchronizeTrainerConfirmation(tx: Prisma.TransactionClient, eventId: string, options: { notifyTrainers?: boolean; notifyVenue?: boolean } = {}) {

  const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, include: eventInclude });

  if (!["PUBLISHED", "PENDING_TRAINER_CONFIRMATION", "PENDING_VENUE_CONFIRMATION"].includes(event.status)) return;

  await ensureVenueApproval(tx, eventId);
  const outstanding = event.trainers.some(assignment => assignment.responseStatus !== "ACCEPTED");

  if (!outstanding) {
    await synchronizeVenueConfirmation(tx, eventId, options.notifyVenue ?? options.notifyTrainers ?? true);
    return;
  }
  if (event.status !== "PENDING_TRAINER_CONFIRMATION") await tx.event.update({ where: { id: eventId }, data: { status: "PENDING_TRAINER_CONFIRMATION" } });
  if (options.notifyTrainers === false) return;

  for (const assignment of event.trainers) {

    if (assignment.trainer.companyId !== event.companyId) throw new TrainerConfirmationError("Der Trainer gehört nicht zur Company des Events.");

    if (assignment.responseStatus !== "PENDING" || assignment.respondedAt !== null) continue;
    const requestKey = `trainer-confirmation:${assignment.id}`;
    const message = {
      to: assignment.trainer.email,
      ...trainerConfirmationMessage(facts(event), `${assignment.trainer.firstName} ${assignment.trainer.lastName}`, `${accountOrigin()}/account/eventmanagement`),
      trainerConfirmation: { assignmentId: assignment.id, companyId: event.companyId },
    };
    await tx.mailOutbox.upsert({ where: { requestKey }, create: { requestKey, kind: "TRAINER_CONFIRMATION", encryptedMessage: encryptPaymentMail(message) }, update: {} });
  }
}

const companyTrainerChangesSchema = z.array(z.object({
  assignmentId: z.string().min(1).max(191), trainerId: z.string().min(1).max(191),
  status: z.enum(["PENDING", "ACCEPTED"]), expectedStatus: z.enum(["PENDING", "ACCEPTED", "ISSUE"]),
  expectedRespondedAt: z.iso.datetime().nullable(),
}).strict()).max(50).refine(changes => new Set(changes.map(change => change.assignmentId)).size === changes.length);
export type CompanyTrainerChanges = z.infer<typeof companyTrainerChangesSchema>;

export function readCompanyTrainerChanges(value: unknown): CompanyTrainerChanges {
  if (value === null) return [];
  try {
    if (typeof value !== "string" || value.length > 30000) throw new Error();
    return companyTrainerChangesSchema.parse(JSON.parse(value));
  } catch { throw new TrainerConfirmationError("Die Trainer-Rückmeldungen sind ungültig. Bitte lade die Seite neu."); }
}

/** Administrative changes are audited by the facade, but never request trainer mail. */
export async function applyCompanyTrainerChanges(tx: Prisma.TransactionClient, companyId: string, eventId: string, userId: string, changes: CompanyTrainerChanges) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true, emailVerified: true } });
  if (!user?.emailVerified) throw new TrainerConfirmationError("Bitte melde dich erneut an.");
  if (user.role !== "ADMIN" && !await tx.companyMembership.findFirst({ where: { companyId, userId, status: "ACTIVE", role: { in: ["COMPANY_USER", "COMPANY_ADMIN"] } }, select: { id: true } })) throw new TrainerConfirmationError("Du darfst diese Trainerzuordnungen nicht bearbeiten.");
  const event = await tx.event.findFirst({ where: { id: eventId, companyId }, select: { status: true, endsAt: true } });
  if (!event || !["DRAFT", "PUBLISHED", "PENDING_TRAINER_CONFIRMATION", "PENDING_VENUE_CONFIRMATION"].includes(event.status)) throw new TrainerConfirmationError("Bei abgesagten oder abgeschlossenen Events kann die Trainerfreigabe nicht geändert werden.");
  if (event.status !== "DRAFT" && event.endsAt && event.endsAt <= new Date()) throw new TrainerConfirmationError("Die Trainerfreigabe kann für ein beendetes Event nicht geändert werden.");
  for (const change of changes) {
    if (change.status === change.expectedStatus) continue;
    const result = await tx.eventTrainer.updateMany({ where: {
      id: change.assignmentId, eventId, trainerId: change.trainerId, trainer: { companyId },
      responseStatus: change.expectedStatus, respondedAt: change.expectedRespondedAt ? new Date(change.expectedRespondedAt) : null,
    }, data: { responseStatus: change.status, respondedAt: new Date() } });
    if (result.count !== 1) throw new TrainerConfirmationError("Eine Trainerantwort wurde inzwischen geändert oder die Zuordnung entfernt. Bitte lade die Seite neu.");
    // A timestamp on PENDING identifies a manual reset. Mail workers and later
    // synchronizations exclude it, including requests already waiting in the outbox.
  }
}

/** One durable request per trainer; individual keys reserve every covered assignment. */
export async function queueBatchTrainerConfirmations(tx: Prisma.TransactionClient, companyId: string, eventIds: string[]) {
  const assignments = await tx.eventTrainer.findMany({
    where: { eventId: { in: eventIds }, responseStatus: "PENDING", respondedAt: null, trainer: { companyId }, event: { companyId, status: "PENDING_TRAINER_CONFIRMATION" } },
    include: { trainer: true, event: { include: eventInclude } },
    orderBy: [{ event: { beginsAt: "asc" } }, { id: "asc" }],
  });
  const groups = new Map<string, typeof assignments>();
  for (const assignment of assignments) {
    const group = groups.get(assignment.trainerId) ?? [];
    group.push(assignment);
    groups.set(assignment.trainerId, group);
  }
  for (const group of groups.values()) {
    const first = group[0];
    const message = { to: first.trainer.email,
      ...trainerBatchConfirmationMessage(group.map(assignment => facts(assignment.event)), `${first.trainer.firstName} ${first.trainer.lastName}`, `${accountOrigin()}/account/eventmanagement`),
      trainerConfirmation: { assignmentIds: group.map(assignment => assignment.id), companyId },
    };
    const requestKey = `trainer-confirmation:${first.id}`;
    await tx.mailOutbox.upsert({ where: { requestKey }, create: { requestKey, kind: "TRAINER_CONFIRMATION", encryptedMessage: encryptPaymentMail(message) }, update: {} });
    // Covered by the grouped job. Later edits/responses must not enqueue individual requests.
    if (group.length > 1) await tx.mailOutbox.createMany({ data: group.slice(1).map(assignment => ({
      requestKey: `trainer-confirmation:${assignment.id}`, kind: "TRAINER_CONFIRMATION" as const,
      cancelledAt: new Date(), lastError: "COVERED_BY_BATCH",
    })), skipDuplicates: true });
  }
}

/** Rebuild grouped mail from still-current assignments before every delivery attempt. */
export async function currentBatchTrainerConfirmation(tx: Prisma.TransactionClient, companyId: string, assignmentIds: string[], to: string, now: Date) {
  const assignments = await tx.eventTrainer.findMany({
    where: { id: { in: assignmentIds }, responseStatus: "PENDING", respondedAt: null, trainer: { companyId, email: { equals: to, mode: "insensitive" } },
      event: { companyId, status: "PENDING_TRAINER_CONFIRMATION", endsAt: { gt: now } } },
    include: { trainer: true, event: { include: eventInclude } },
    orderBy: [{ event: { beginsAt: "asc" } }, { id: "asc" }],
  });
  if (!assignments.length) return null;
  const trainer = assignments[0].trainer;
  return trainerBatchConfirmationMessage(assignments.map(assignment => facts(assignment.event)), `${trainer.firstName} ${trainer.lastName}`, `${accountOrigin()}/account/eventmanagement`);
}

/** Identity, tenant, state transition, note and notifications are checked/written atomically. */
export async function respondToTrainerAssignment(userId: string, assignmentId: string, response: "ACCEPTED" | "ISSUE", body: unknown, requestId?: unknown) {
  if (typeof assignmentId !== "string" || !assignmentId.trim() || assignmentId.length > 191 || !["ACCEPTED", "ISSUE"].includes(response)) throw new TrainerConfirmationError("Ungültige Rückmeldung.");
  const issue = response === "ISSUE" ? trainerIssueSchema.safeParse(body) : null;
  if (issue && !issue.success) throw new TrainerConfirmationError(issue.error.issues[0].message);
  if (response === "ISSUE" && (typeof requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))) throw new TrainerConfirmationError("Bitte öffne das Problemformular erneut.");
  const noteId = response === "ISSUE" ? `trainer-issue:${assignmentId}:${requestId}` : null;
  await getPrisma().$transaction(async tx => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { emailVerified: true, email: true } });
    const assignment = await tx.eventTrainer.findFirst({ where: { id: assignmentId, trainer: { userId } }, include: { trainer: true, event: { include: eventInclude } } });
    if (!user?.emailVerified || !assignment || assignment.trainer.companyId !== assignment.event.companyId) throw new TrainerConfirmationError("Diese Trainerzuordnung ist nicht verfügbar.");

    if (noteId) {
      const existing = await tx.note.findUnique({ where: { id: noteId }, select: { eventId: true, authorId: true, body: true } });
      if (existing) {
        if (existing.eventId !== assignment.eventId || existing.authorId !== userId || !issue?.success || existing.body !== issue.data) throw new TrainerConfirmationError("Diese Meldung wurde bereits mit anderem Inhalt gespeichert. Bitte öffne das Formular erneut.");
        return;
      }
    }
    if (response === "ACCEPTED") {
      if (!["PENDING", "ISSUE"].includes(assignment.responseStatus) || assignment.event.status !== "PENDING_TRAINER_CONFIRMATION") throw new TrainerConfirmationError("Für diese Zuordnung ist keine Zusage mehr möglich. Bitte lade die Seite neu.");
      if (!assignment.event.endsAt || assignment.event.endsAt <= new Date()) throw new TrainerConfirmationError("Diese Veranstaltung ist bereits beendet.");
    } else if (!["PENDING_TRAINER_CONFIRMATION", "PENDING_VENUE_CONFIRMATION", "PUBLISHED", "CANCELLED", "COMPLETED"].includes(assignment.event.status)) {
      throw new TrainerConfirmationError("Für diese Veranstaltung kann derzeit kein Problem gemeldet werden.");
    }
    const updated = await tx.eventTrainer.updateMany({ where: { id: assignmentId, responseStatus: assignment.responseStatus, trainer: { userId, companyId: assignment.event.companyId } }, data: { responseStatus: response, respondedAt: new Date() } });
    if (updated.count !== 1) throw new TrainerConfirmationError("Die Rückmeldung wurde inzwischen geändert. Bitte lade die Seite neu.");
    // Serialize responses and Company edits without reopening cancelled/completed events.
    const eventStatus = ["PUBLISHED", "PENDING_TRAINER_CONFIRMATION", "PENDING_VENUE_CONFIRMATION"].includes(assignment.event.status)
      ? "PENDING_TRAINER_CONFIRMATION" : assignment.event.status;
    await tx.event.update({ where: { id: assignment.eventId }, data: { status: eventStatus } });

    if (response === "ISSUE" && issue?.success) {

      const note = await tx.note.create({ data: { id: noteId!, eventId: assignment.eventId, authorId: userId, body: issue.data, visibility: "COMPANY" } });

      for (const to of await companyRecipients(tx, assignment.event.companyId, "notifyTrainerIssues")) {

        const message: CompanyMessage = { to,

          ...trainerIssueMessage(facts(assignment.event), `${assignment.trainer.firstName} ${assignment.trainer.lastName}`, issue.data, `${accountOrigin()}/company/${encodeURIComponent(assignment.event.company.slug)}/events/${encodeURIComponent(assignment.eventId)}`, user.email),

          companyNotification: { companyId: assignment.event.companyId, type: "notifyTrainerIssues" },

        };

        const requestKey = `trainer-issue:${note.id}:${to}`;

        await tx.mailOutbox.upsert({ where: { requestKey }, create: { requestKey, kind: "COMPANY_NOTIFICATION", encryptedMessage: encryptPaymentMail(message) }, update: {} });

      }

    }

    if (response === "ISSUE" && ["PUBLISHED", "PENDING_TRAINER_CONFIRMATION", "PENDING_VENUE_CONFIRMATION"].includes(assignment.event.status)) {
      await tx.eventTrainer.delete({ where: { id: assignmentId } });
      await tx.event.update({ where: { id: assignment.eventId }, data: { status: "TRAINER_NOT_SET", trainerName: null } });
    }
    await synchronizeTrainerConfirmation(tx, assignment.eventId);

  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

}

