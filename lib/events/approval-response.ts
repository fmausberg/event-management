import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/lib/db/prisma";
import { trainerIssueSchema, synchronizeTrainerConfirmation, TrainerConfirmationError } from "@/lib/trainers/confirmation";
import { ensureVenueApproval } from "@/lib/venues/confirmation";
import { eligibleVenueApprovalMember } from "@/lib/venues/approval-members";
import { companyRecipients, type CompanyMessage, type NotificationType } from "@/lib/companies/notifications";
import { eventApprovalIssueMessage } from "@/lib/mail/templates/trainer-confirmation";
import { encryptPaymentMail } from "@/lib/payments/mail";
import { accountOrigin } from "@/lib/auth/verification";

/** A single event action applies only to the actor's currently assigned roles. */
export async function respondToOwnEventRoles(userId: string, eventId: string, response: "ACCEPTED" | "ISSUE", body: unknown, requestId: unknown, venueVersion: unknown) {
  if (typeof eventId !== "string" || !eventId.trim() || eventId.length > 191 || !["ACCEPTED", "ISSUE"].includes(response)) throw new TrainerConfirmationError("Ungültige Rückmeldung.");
  const issue = response === "ISSUE" ? trainerIssueSchema.safeParse(body) : null;
  if (issue && !issue.success) throw new TrainerConfirmationError(issue.error.issues[0].message);
  if (response === "ISSUE" && !z.uuid().safeParse(requestId).success) throw new TrainerConfirmationError("Bitte öffne das Problemformular erneut.");
  const noteId = response === "ISSUE" ? `event-issue:${eventId}:${requestId}` : null;
  await getPrisma().$transaction(async tx => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { emailVerified: true, name: true, email: true } });
    if (!user?.emailVerified) throw new TrainerConfirmationError("Bitte melde dich erneut an.");
    const event = await tx.event.findFirst({ where: { id: eventId, OR: [
      { trainers: { some: { trainer: { userId } } } },
      { venue: { staff: { some: { ...eligibleVenueApprovalMember, userId } } } },
    ] }, include: {
      company: { select: { name: true, slug: true } }, venueApproval: true,
      venue: { include: { staff: { where: { ...eligibleVenueApprovalMember, userId }, select: { id: true } } } },
      trainers: { include: { trainer: { select: { userId: true, companyId: true } } } },
    } });
    if (!event) throw new TrainerConfirmationError("Diese Veranstaltung ist nicht verfügbar.");
    const ownTrainers = event.trainers.filter(assignment => assignment.trainer.userId === userId && assignment.trainer.companyId === event.companyId);
    const ownVenue = !!event.venue?.staff.length && (!event.venueApproval || event.venueApproval.venueId === event.venueId);
    const active = ["PUBLISHED", "PENDING_TRAINER_CONFIRMATION", "PENDING_VENUE_CONFIRMATION"].includes(event.status);
    // Stage one is visible to trainers. A venue-only member cannot approve it by proxy.
    const venueStageVisible = ownVenue && (ownTrainers.length > 0 || event.trainers.every(assignment => assignment.responseStatus === "ACCEPTED"));
    if (!ownTrainers.length && !venueStageVisible) throw new TrainerConfirmationError("Diese Freigabe ist derzeit nicht verfügbar.");
    if (noteId) {
      const existing = await tx.note.findUnique({ where: { id: noteId }, select: { authorId: true, eventId: true, body: true } });
      if (existing) {
        if (existing.authorId !== userId || existing.eventId !== eventId || !issue?.success || existing.body !== issue.data) throw new TrainerConfirmationError("Diese Meldung wurde bereits mit anderem Inhalt gespeichert.");
        return;
      }
    }
    if (response === "ACCEPTED" && (!active || !event.endsAt || event.endsAt <= new Date())) throw new TrainerConfirmationError("Diese Veranstaltung kann nicht mehr bestätigt werden.");
    if (response === "ISSUE" && !active && !["CANCELLED", "COMPLETED"].includes(event.status)) throw new TrainerConfirmationError("Für dieses Event kann kein Problem gemeldet werden.");

    const trainersToChange = response === "ISSUE" ? ownTrainers : ownTrainers.filter(assignment => assignment.responseStatus !== "ACCEPTED");
    if (response === "ACCEPTED" && trainersToChange.length && event.status !== "PENDING_TRAINER_CONFIRMATION") throw new TrainerConfirmationError("Die Trainerfreigabe wurde inzwischen geändert. Bitte lade die Seite neu.");
    const venueToChange = !!venueStageVisible && (response === "ISSUE" || (event.venueApproval?.status ?? "ACCEPTED") !== "ACCEPTED");
    if (response === "ACCEPTED" && venueToChange && event.status !== "PENDING_VENUE_CONFIRMATION" && !(ownTrainers.length && event.status === "PENDING_TRAINER_CONFIRMATION")) throw new TrainerConfirmationError("Die Ortsfreigabe ist derzeit nicht offen.");
    if (!trainersToChange.length && !venueToChange) throw new TrainerConfirmationError("Es ist keine eigene Freigabe mehr offen. Bitte lade die Seite neu.");
    // If a colleague already approved the venue, do not touch that approval and
    // still allow the actor to confirm their independent trainer assignment.
    if (venueToChange && (event.venueApproval?.updatedAt ?? event.updatedAt).toISOString() !== venueVersion) throw new TrainerConfirmationError("Das Ortsteam hat inzwischen geantwortet. Bitte lade die Seite neu.");

    const respondedAt = new Date();
    for (const assignment of trainersToChange) {
      const changed = await tx.eventTrainer.updateMany({ where: { id: assignment.id, eventId, responseStatus: assignment.responseStatus, respondedAt: assignment.respondedAt, trainer: { userId, companyId: event.companyId } }, data: { responseStatus: response, respondedAt } });
      if (changed.count !== 1) throw new TrainerConfirmationError("Die Trainerantwort wurde gleichzeitig geändert. Bitte lade die Seite neu.");
    }
    if (venueToChange) {
      const approval = await ensureVenueApproval(tx, eventId);
      const changed = await tx.eventVenueApproval.updateMany({ where: { id: approval.id, eventId, updatedAt: approval.updatedAt }, data: { status: response, respondedAt, respondedById: userId, manual: false } });
      if (changed.count !== 1) throw new TrainerConfirmationError("Die Ortsfreigabe wurde gleichzeitig geändert. Bitte lade die Seite neu.");
    }
    await tx.event.update({ where: { id: eventId }, data: { status: event.status } });
    if (issue?.success && noteId) {
      await tx.note.create({ data: { id: noteId, eventId, authorId: userId, body: issue.data, visibility: "COMPANY" } });
      const types: NotificationType[] = [];
      if (trainersToChange.length) types.push("notifyTrainerIssues");
      if (venueToChange) types.push("notifyVenueIssues");
      const recipients = new Set<string>();
      for (const type of types) for (const to of await companyRecipients(tx, event.companyId, type)) recipients.add(to);
      const venue = event.venue;
      const eventFacts = { name: event.name, beginsAt: event.beginsAt, endsAt: event.endsAt, company: event.company.name,
        venue: venue ? [venue.name, venue.addressLine1, venue.addressLine2, [venue.postalCode, venue.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "Noch offen" };
      const role = trainersToChange.length && venueToChange ? "Trainer und Ortsteam" : trainersToChange.length ? "Trainer" : "Ortsteam";
      for (const to of recipients) {
        const message: CompanyMessage = { to, ...eventApprovalIssueMessage(eventFacts, user.name ?? user.email, role, issue.data, `${accountOrigin()}/company/${encodeURIComponent(event.company.slug)}/events/${encodeURIComponent(eventId)}`),
          companyNotification: { companyId: event.companyId, type: types[0]!, additionalTypes: types.slice(1) } };
        const requestKey = `event-issue:${noteId}:${to}`;
        await tx.mailOutbox.upsert({ where: { requestKey }, create: { requestKey, kind: "COMPANY_NOTIFICATION", encryptedMessage: encryptPaymentMail(message) }, update: {} });
      }
    }
    await synchronizeTrainerConfirmation(tx, eventId);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
