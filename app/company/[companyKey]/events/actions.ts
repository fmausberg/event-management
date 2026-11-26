"use server";
import { deliverEventbritePublications, queueEventbritePublication } from "@/lib/eventbrite/publication";
import { eligibleVenueApprovalMember } from "@/lib/venues/approval-members";
import { randomUUID } from "node:crypto";
import { queueVenueConfirmations, ensureVenueApproval, initializeVenueApprovals, applyCompanyVenueChange, readCompanyVenueChange, VenueConfirmationError, type CompanyVenueChange } from "@/lib/venues/confirmation";

import { applyCompanyTrainerChanges, readCompanyTrainerChanges, queueBatchTrainerConfirmations, synchronizeTrainerConfirmation, TrainerConfirmationError, type CompanyTrainerChanges } from "@/lib/trainers/confirmation";

import { deliverPendingCompanyNotifications, deliverPendingTrainerConfirmations, deliverPendingVenueConfirmations } from "@/lib/tickets/outbox";

import { resolveEventTax, TaxError, taxOverrideFromForm } from "@/lib/taxes/service";

import { withSessionAudit } from "@/lib/audit/session";

import { sanitizeDescription } from "@/lib/descriptions/html";

import { Prisma } from "@prisma/client";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";

import { requireCompanyAccess, requireCompanyAdmin, MemberAccessError } from "@/lib/companies/members";

import { getPrisma } from "@/lib/db/prisma";

import { eventSchema, publishEventSchema, emptyEvent, type EventState } from "@/lib/company-events/model";

import { uploadEventImage, deleteEventImage, EventImageError, type UploadedEventImage } from "@/lib/events/images";

import { requestTrainerReminderNow } from "@/lib/trainers/reminders";

import { calendarRange, parseBatchSchedule, type BatchOccurrence } from "@/lib/company-events/batch-schedule";

import { occupiedSeriesDates } from "@/lib/company-events/batch-conflicts";

export type TrainerReminderActionState = { success?: boolean; sent?: boolean; sentAt?: string | null; message?: string };

function refresh(slug: string) {

 revalidatePath("/company/[companyKey]/events/[eventId]", "page");

 revalidatePath("/company/[companyKey]/event-series/[seriesId]", "page");

 revalidatePath("/account/eventmanagement");

 revalidatePath("/account/bookings");

 revalidatePath("/account");

 revalidatePath(`/company/${encodeURIComponent(slug)}/trainers`);

 revalidatePath("/events/[companySlug]/[eventId]", "page");

 for (const path of [`/company/${encodeURIComponent(slug)}/events`, `/company/${encodeURIComponent(slug)}/event-series`, `/company/${encodeURIComponent(slug)}/venues`, "/admin/companies", "/admin/events", "/events", `/events/${encodeURIComponent(slug)}`]) revalidatePath(path);

}

function failure(error: unknown): EventState {

 if (error instanceof TaxError) return { message: "Die Veranstaltung kann wegen einer unvollständigen Steuerkonfiguration nicht veröffentlicht werden. Bitte einen Company Admin kontaktieren." };

 if (error instanceof MemberAccessError) return { message: error.message };

 if (error instanceof EventImageError || error instanceof TrainerConfirmationError || error instanceof VenueConfirmationError) return { message: error.message };

 // Serialize explicitly: the development logger otherwise records object arguments as {}.
 // Never include raw Prisma messages, SQL parameters or form values.
 const details = error && typeof error === "object" ? error as { name?: unknown; code?: unknown; stack?: unknown } : {};
 const errorType = typeof details.name === "string" && /^[A-Za-z0-9_]+$/.test(details.name) ? details.name : "UnknownError";
 const errorCode = typeof details.code === "string" && /^P[0-9]{4}$/.test(details.code) ? details.code : undefined;
 const frames = typeof details.stack === "string" ? details.stack.split("\n").filter(line => /^\s+at /.test(line)).slice(0, 6).map(line => line.trim()) : [];
 console.error(`[company-events] Save failed ${JSON.stringify({ errorType, code: errorCode, frames })}`);
 if (errorCode === "P2028") return { message: "Das Speichern hat zu lange gedauert. Bitte versuche es erneut." };

 if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return { message: "Die Daten wurden gleichzeitig geändert. Es wurde nichts gespeichert. Bitte prüfe die Termine und versuche es erneut." };

 if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") return { message: "Die Veranstaltung ist noch verknüpft oder eine Zuordnung wurde geändert. Bitte lade die Seite neu." };

 return { message: "Die Änderung konnte nicht gespeichert werden. Bitte versuche es erneut." };

}

function validId(id: unknown): id is string { return typeof id === "string" && !!id.trim() && id.length <= 191; }

export async function getSeriesDateConflicts(slug: string, seriesId: string, from: string, to: string): Promise<{ dates: string[]; message?: string }> {

 try {

  const { company } = await requireCompanyAccess(slug);

  if (!validId(seriesId) || !calendarRange(from, to).length) return { dates: [], message: "Bitte einen gültigen Zeitraum von höchstens 366 Tagen auswählen." };

  const db = getPrisma();

  if (!await db.eventSeries.findFirst({ where: { id: seriesId, companyId: company.id }, select: { id: true } })) return { dates: [], message: "Bitte wähle eine Veranstaltungsreihe dieser Company." };

  return { dates: await occupiedSeriesDates(db, company.id, seriesId, from, to) };

 } catch (error) { return { dates: [], message: failure(error).message }; }

}

export async function saveEvent(slug: string, id: string | null, _previous: EventState, form: FormData): Promise<EventState> {

  return withSessionAudit("company/[companyKey]/events.saveEvent", async () => {

 const intent = form.get("intent") ?? (id === null ? "draft" : "save");

 const multiple = form.get("creationMode") === "multiple";
 const eventbriteValues = form.getAll("postToEventbrite");
 if (eventbriteValues.length > 1 || eventbriteValues.some(value => value !== "yes" && value !== "no")) return { message: "Ungültige Eventbrite-Auswahl." };
 const postToEventbrite = eventbriteValues[0] === "yes";

 const consentValues = form.getAll("trainerConsentObtained");
 if (consentValues.length > 1 || consentValues.some(value => value !== "yes")) return { message: "Ungültige Trainerzustimmung." };
 const trainerConsentObtained = consentValues.length === 1 && (id === null || intent === "publish");
 const venueConsentValues = form.getAll("venueConsentObtained");
 if (venueConsentValues.length > 1 || venueConsentValues.some(value => value !== "yes")) return { message: "Ungültige Ortsfreigabe." };
 const venueConsentObtained = venueConsentValues.length === 1 && (id === null || intent === "publish");
 if (venueConsentObtained && id !== null && intent !== "publish") return { message: "Bitte starte den Veröffentlichungsprozess, um die Ortsfreigabe zu speichern." };

 if (trainerConsentObtained && id !== null && intent !== "publish") return { message: "Bitte starte den Veröffentlichungsprozess, um die Trainerzustimmung zu speichern." };


 if (multiple && (id !== null || !["draft", "publish"].includes(String(intent)))) return { message: "Mehrfacherstellung ist nur für neue Veranstaltungen möglich." };

 if (intent === "cancel") return cancelEvent(slug, id);

 if (!["draft", "publish", "save"].includes(String(intent))) return { message: "Ungültige Aktion." };

 let uploaded: UploadedEventImage | undefined;

 let saved = false;

 let createdCount = 0;

 let createdId: string | undefined;

 let canConfigureTaxes = false;

 let trainerResponseChanges: CompanyTrainerChanges = [];
 let venueResponseChange: CompanyVenueChange | null = null;
 let manualApprovalChange = false;

 try {

  const { company, canManageMembers } = await requireCompanyAccess(slug);

  canConfigureTaxes = canManageMembers;

  trainerResponseChanges = readCompanyTrainerChanges(form.get("trainerResponseChanges"));
  if (trainerResponseChanges.length && id === null) throw new TrainerConfirmationError("Trainerantworten können nur für bestehende Zuordnungen geändert werden.");
  venueResponseChange = readCompanyVenueChange(form.get("venueResponseChange"));
  if (venueResponseChange && id === null) throw new VenueConfirmationError("Ortsfreigaben können nur für bestehende Events geändert werden.");
  manualApprovalChange = trainerResponseChanges.length > 0 || venueResponseChange !== null;
  const needsResponseActor = manualApprovalChange || trainerConsentObtained || venueConsentObtained;
  const responseActorId = needsResponseActor ? (await auth())?.user?.id : undefined;
  if (needsResponseActor && !responseActorId) throw new MemberAccessError("UNAUTHENTICATED");


  if (id !== null && !validId(id)) return { message: "Ungültige Veranstaltung." };

  const taxFields = form.has("taxMode") || form.has("taxRate") || form.has("taxRateOverride");

  if (taxFields) await requireCompanyAdmin(slug);

  const taxData = taxFields ? { taxRateOverride: taxOverrideFromForm(form) } : {};

  const db = getPrisma();

  const existing = id === null ? null : await db.event.findFirst({ where: { id, companyId: company.id }, select: { status: true, imageUrl: true, postToEventbrite: true, eventbritePublication: { select: { status: true } } } });

  if (id !== null && (!existing || (intent !== "save" && (intent === "publish" ? ["CANCELLED", "COMPLETED"].includes(existing.status) : !["DRAFT", "TRAINER_NOT_SET", "VENUE_NOT_SET"].includes(existing.status))))) return { message: "Die Veranstaltung ist nicht verfügbar. Bitte lade die Seite neu." };

  if (existing?.eventbritePublication && postToEventbrite !== existing.postToEventbrite) return { message: "Der Eventbrite-Auftrag wurde bereits angelegt. Bitte Änderungen und Absagen direkt in Eventbrite verwalten." };
  if (postToEventbrite && !existing?.eventbritePublication) {
    const connection = await db.eventbriteConnection.findUnique({ where: { companyId: company.id }, select: { status: true } });
    if (connection?.status !== "CONNECTED") return { message: "Bitte zuerst eine gültige Eventbrite-Verbindung in den Company-Einstellungen herstellen." };
  }

  const schema = intent === "publish" || ["PUBLISHED", "PENDING_TRAINER_CONFIRMATION", "PENDING_VENUE_CONFIRMATION"].includes(existing?.status ?? "") ? publishEventSchema : eventSchema;

  let occurrences: BatchOccurrence[] = [];

  if (multiple) {

   if (!validId(form.get("eventSeriesId"))) return { message: "Bitte zuerst eine Veranstaltungsreihe auswählen." };

   const schedule = parseBatchSchedule(form);

   if (schedule.message) return { message: schedule.message, dateErrors: schedule.dateErrors };

   occurrences = schedule.occurrences;

  }

  const raw = Object.fromEntries(Object.keys(emptyEvent).map((key) => [key, key === "currency" ? "EUR" : key === "status" ? "DRAFT" : key === "trainerIds" ? form.getAll(key) : form.get(key) ?? ""]));

  const parsed = schema.safeParse({ ...raw, ...(multiple ? { beginsAt: occurrences[0].beginsAt, endsAt: occurrences[0].endsAt } : {}) });

  if (!parsed.success) return { message: "Bitte korrigiere die markierten Felder.", errors: parsed.error.flatten().fieldErrors };

  parsed.data.description = sanitizeDescription(parsed.data.description);

  if (multiple) {

   const dateErrors: Record<string, string> = {};

   const now = new Date();

   for (const occurrence of occurrences) {

    const validation = schema.safeParse({ ...raw, beginsAt: occurrence.beginsAt, endsAt: occurrence.endsAt });

    if (!validation.success) dateErrors[occurrence.date] = validation.error.issues.map(issue => issue.message).join(" ");

    else if (intent === "publish" && new Date(occurrence.endsAt) <= now) dateErrors[occurrence.date] = "Ein bereits beendetes Veranstaltung kann nicht veröffentlicht werden.";

   }

   if (Object.keys(dateErrors).length) return { message: "Nicht alle Termine können gespeichert werden. Bitte die markierten Termine prüfen.", dateErrors };

  }

  if (intent === "publish" && new Date(parsed.data.endsAt) <= new Date()) return { message: "Ein bereits beendetes Veranstaltung kann nicht veröffentlicht werden.", errors: { endsAt: ["Das Ende muss für die Veröffentlichung in der Zukunft liegen."] } };

  const { eventSeriesId, venueId } = parsed.data;

  const series = eventSeriesId ? await db.eventSeries.findFirst({ where: { id: eventSeriesId, companyId: company.id }, select: { id: true, imageUrl: true } }) : null;

  if (eventSeriesId && !series) return { message: "Bitte wähle eine Veranstaltungsreihe dieser Company." };

  if (venueId && !await db.venue.findFirst({ where: { id: venueId, companyId: company.id }, select: { id: true } })) return { message: "Bitte wähle einen Ort dieser Company." };

  const { trainerIds, status: ignoredStatus, ...fields } = parsed.data;

  void ignoredStatus;

  const trainers = await db.trainer.findMany({ where: { id: { in: trainerIds }, companyId: company.id }, select: { id: true } });

  if (trainerResponseChanges.some(change => !trainerIds.includes(change.trainerId))) throw new TrainerConfirmationError("Entfernte Trainer können nicht gleichzeitig eine neue Freigabe erhalten.");

  if (trainers.length !== trainerIds.length) return { message: "Bitte wähle Trainer dieser Company.", errors: { trainerIds: ["Mindestens ein Trainer ist nicht verfügbar."] } };

  const file = form.get("coverImage");

  const hasUpload = file instanceof File && file.size > 0;

  const removeImage = form.get("removeImage") === "yes";

  if (file !== null && !(file instanceof File)) return { message: "Ungültige Bilddatei." };

  if (hasUpload && removeImage) return { message: "Bitte entweder ein Bild auswählen oder das vorhandene entfernen." };

  if (intent === "publish" && form.get("confirmMissingOptional") !== "yes") {

   const warnings: string[] = [];

   if (!hasUpload && (removeImage || !(id === null ? series?.imageUrl : existing?.imageUrl))) warnings.push("Titelbild");

   if (!trainerIds.length) warnings.push("Trainer");

   if (!parsed.data.description) warnings.push("Beschreibung");

   if (warnings.length) return { warnings, message: "Möchtest du die fehlenden Angaben noch ergänzen?" };

  }

  if (hasUpload) uploaded = await uploadEventImage(company.id, file);

  const data = { ...fields, postToEventbrite, ...taxData, ...(uploaded ?? (removeImage ? { imageUrl: null, imagePublicId: null } : id === null && series ? { imageUrl: series.imageUrl, imagePublicId: null } : {})), trainerName: null, beginsAt: parsed.data.beginsAt ? new Date(parsed.data.beginsAt) : null, endsAt: parsed.data.endsAt ? new Date(parsed.data.endsAt) : null };

  if (id === null) {

   const session = await auth();

   if (!session?.user?.id) return { message: "Bitte melde dich erneut an." };

   const actorId = session.user.id;

   const creationData = { ...data, status: intent === "publish" ? trainerIds.length && !trainerConsentObtained ? "PENDING_TRAINER_CONFIRMATION" as const : "PUBLISHED" as const : "DRAFT" as const, companyId: company.id, createdById: actorId,
     trainers: { create: trainerIds.map((trainerId) => ({ trainerId, responseStatus: trainerConsentObtained ? "ACCEPTED" as const : "PENDING" as const, respondedAt: trainerConsentObtained ? new Date() : null })) } };
   const consentNote = "Trainerzustimmung bereits erfolgt: Das erstellende Company-Mitglied hat die vorherige Zustimmung aller ausgewählten Trainer bestätigt.";

   if (multiple) {

    const result = await db.$transaction(async (tx): Promise<EventState> => {

     const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true } });

     if (!actor) throw new MemberAccessError("UNAUTHENTICATED");

     if (actor.role !== "ADMIN") {

      const member = await tx.companyMembership.findUnique({ where: { companyId_userId: { companyId: company.id, userId: actorId } }, select: { role: true, status: true } });

      if (member?.status !== "ACTIVE" || !["COMPANY_ADMIN", "COMPANY_USER"].includes(member.role)) throw new MemberAccessError("FORBIDDEN");

     }

     const currentSeries = await tx.eventSeries.findFirst({ where: { id: eventSeriesId!, companyId: company.id }, select: { id: true, imageUrl: true } });

     if (!currentSeries) return { message: "Die ausgewählte Veranstaltungsreihe ist nicht mehr verfügbar." };

     const batchVenue = venueId ? await tx.venue.findFirst({ where: { id: venueId, companyId: company.id }, select: { id: true, _count: { select: { staff: { where: eligibleVenueApprovalMember } } } } }) : null;
     if (venueId && !batchVenue) return { message: "Bitte wähle einen Ort dieser Company." };

     const currentTrainers = await tx.trainer.findMany({ where: { id: { in: trainerIds }, companyId: company.id }, select: { id: true } });

     if (currentTrainers.length !== trainerIds.length) return { message: "Mindestens ein Trainer ist nicht mehr verfügbar.", errors: { trainerIds: ["Bitte die Trainerzuordnung prüfen."] } };

     if (!hasUpload && !removeImage && currentSeries.imageUrl !== series?.imageUrl) return { message: "Das Bild der Reihe wurde geändert. Bitte die Auswahl prüfen und erneut speichern." };

     if (intent === "publish" && occurrences.some(item => new Date(item.endsAt) <= new Date())) return { message: "Mindestens ein Termin ist inzwischen beendet. Bitte die Auswahl prüfen. Es wurde nichts angelegt." };

     // Bulk inserts keep a long schedule within one audited transaction.
     const { trainers: trainerAssignments, ...batchCreationData } = creationData;
     const batchStatus = batchCreationData.status === "PUBLISHED" && !venueConsentObtained && batchVenue?._count.staff
       ? "PENDING_VENUE_CONFIRMATION" as const : batchCreationData.status;
     const created = await tx.event.createManyAndReturn({ data: occurrences.map(occurrence => ({
       ...batchCreationData, status: batchStatus, beginsAt: new Date(occurrence.beginsAt), endsAt: occurrence.endsAt ? new Date(occurrence.endsAt) : null,
     })), select: { id: true } });
     if (trainerIds.length) await tx.eventTrainer.createMany({ data: created.flatMap(event => trainerAssignments.create.map(assignment => ({ ...assignment, eventId: event.id }))) });
     if (trainerConsentObtained && trainerIds.length) await tx.note.createMany({ data: created.map(event => ({ eventId: event.id, authorId: actorId, body: consentNote, visibility: "COMPANY" as const })) });
     await initializeVenueApprovals(tx, created.map(event => event.id), venueConsentObtained, actorId, randomUUID());
     if (intent === "publish") {
       for (const event of created) await resolveEventTax(tx, event.id);
       if (!venueConsentObtained) await queueVenueConfirmations(tx, created.map(event => event.id));
       if (!trainerConsentObtained) await queueBatchTrainerConfirmations(tx, company.id, created.map(event => event.id));
     }

     return { success: true };

    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });

    if (!result.success) return result;

    createdCount = occurrences.length;

   } else {

    const created = await db.$transaction(async tx => {

     const created = await tx.event.create({ data: creationData, select: { id: true, status: true } });

     if (trainerConsentObtained && trainerIds.length) await tx.note.create({ data: { eventId: created.id, authorId: actorId, body: consentNote, visibility: "COMPANY" } });
     await initializeVenueApprovals(tx, [created.id], venueConsentObtained, actorId);
     if (intent === "publish") { await resolveEventTax(tx, created.id); await synchronizeTrainerConfirmation(tx, created.id); }

     return created;

    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    createdId = created.id;

   }

  } else {

   const result = await db.$transaction(async (tx) => {

    const current = await tx.event.findFirst({ where: { id, companyId: company.id }, select: { status: true, imagePublicId: true, venueId: true } });

    if (!current || current.status !== existing?.status || (intent !== "save" && (intent === "publish" ? ["CANCELLED", "COMPLETED"].includes(current.status) : !["DRAFT", "TRAINER_NOT_SET", "VENUE_NOT_SET"].includes(current.status)))) return { count: 0 };

    if (current.venueId !== venueId) await ensureVenueApproval(tx, id);
    const updated = await tx.event.updateMany({ where: { id, companyId: company.id, status: current.status }, data: { ...data, status: intent === "publish" ? "PUBLISHED" : current.status } });

    if (!updated.count) return updated;

    await tx.eventTrainer.deleteMany({ where: { eventId: id, trainerId: { notIn: trainerIds } } });

    if (trainerIds.length) await tx.eventTrainer.createMany({ data: trainerIds.map((trainerId) => ({ eventId: id, trainerId })), skipDuplicates: true });

    if (intent === "publish" && trainerConsentObtained && trainerIds.length) {
      const confirmed = await tx.eventTrainer.updateMany({ where: { eventId: id, responseStatus: { not: "ACCEPTED" } }, data: { responseStatus: "ACCEPTED", respondedAt: new Date() } });
      if (confirmed.count) await tx.note.create({ data: { eventId: id, authorId: responseActorId!, body: "Trainerzustimmung bereits erfolgt: Das Company-Mitglied hat die vorherige Zustimmung bestätigt.", visibility: "COMPANY" } });
    }
    if (intent === "publish" && venueConsentObtained) {
      const approval = await ensureVenueApproval(tx, id);
      if (approval.status !== "ACCEPTED") await tx.eventVenueApproval.update({ where: { id: approval.id }, data: { status: "ACCEPTED", respondedAt: new Date(), respondedById: responseActorId!, manual: true } });
    }

    if (trainerResponseChanges.length) await applyCompanyTrainerChanges(tx, company.id, id, responseActorId!, trainerResponseChanges);
    if (venueResponseChange) await applyCompanyVenueChange(tx, company.id, id, responseActorId!, venueResponseChange);
    if (!manualApprovalChange && (intent === "publish" || current.status === "PUBLISHED")) await resolveEventTax(tx, id);

    await synchronizeTrainerConfirmation(tx, id, { notifyTrainers: !manualApprovalChange, notifyVenue: !manualApprovalChange });

    if (postToEventbrite) {
      const final = await tx.event.findUniqueOrThrow({ where: { id }, select: { status: true } });
      if (final.status === "PUBLISHED") await queueEventbritePublication(tx, id);
    }
    return updated;

   }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

   if (!result.count) return { message: "Die Veranstaltung existiert nicht in dieser Company oder sein Status hat sich geändert. Bitte lade die Seite neu." };

  }

  saved = true;

 } catch (error) {

  if (error instanceof TaxError && canConfigureTaxes) return { message: error.message };

  return failure(error);

 }

 finally { if (uploaded && !saved) await deleteEventImage(uploaded.imagePublicId); }

 try { await deliverEventbritePublications((await requireCompanyAccess(slug)).company.id); } catch { /* Durable publication work remains visible and recoverable. */ }
 try { await deliverPendingCompanyNotifications(); } catch { /* Durable outbox retries independently. */ }
 if (!manualApprovalChange) { await deliverPendingTrainerConfirmations(); await deliverPendingVenueConfirmations(); }

 refresh(slug);

 if (multiple) return { success: true, message: `${createdCount} Veranstaltungen wurden ${intent === "publish" ? "zur Veröffentlichung gespeichert" : "als Entwurf erstellt"}.` };

 return { success: true, id: createdId, message: intent === "publish" ? "Veranstaltung wurde zur Veröffentlichung gespeichert. Bei offenen Trainer- oder Ortsfreigaben bleibt sie unveröffentlicht." : id === null ? "Entwurf wurde erstellt." : "Veranstaltung wurde gespeichert." };



  });

}

async function cancelEvent(slug: string, id: string | null): Promise<EventState> {

 try {

  const { company } = await requireCompanyAccess(slug);

  if (!validId(id)) return { message: "Ungültige Veranstaltung." };

  const result = await getPrisma().$transaction(async tx => {
    const result = await tx.event.updateMany({ where: { id, companyId: company.id, status: { in: ["PUBLISHED", "PENDING_TRAINER_CONFIRMATION", "PENDING_VENUE_CONFIRMATION"] }, endsAt: { gt: new Date() } }, data: { status: "CANCELLED" } });
    if (result.count) await queueVenueConfirmations(tx, [id]);
    return result;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  if (!result.count) return { message: "Nur veröffentlichte oder auf Trainerbestätigung wartende, noch nicht beendete Veranstaltungen können abgesagt werden. Bitte lade die Seite neu." };

 } catch (error) { return failure(error); }

 await deliverPendingVenueConfirmations();
 refresh(slug);

 return { success: true, message: "Veranstaltung wurde abgesagt." };

}

export async function deleteEvent(slug: string, id: string, _previous: EventState, form: FormData): Promise<EventState> {

  return withSessionAudit("company/[companyKey]/events.deleteEvent", async () => {

 try {

  const { company } = await requireCompanyAccess(slug);

  if (!validId(id) || form.get("confirmed") !== "yes") return { message: "Bitte bestätige das Löschen." };

  const result = await getPrisma().$transaction(async (tx) => {

   const approval = await tx.eventVenueApproval.findUnique({ where: { eventId: id }, select: { batchId: true } });
   const deleted = await tx.event.deleteMany({ where: { id, companyId: company.id, bookings: { none: {} }, platformEvents: { none: {} }, eventbritePublication: { is: null } } });

   if (deleted.count && approval?.batchId) {
     const peer = await tx.eventVenueApproval.findFirst({ where: { batchId: approval.batchId }, select: { eventId: true } });
     if (peer) await queueVenueConfirmations(tx, [peer.eventId]);
   }
   return deleted;

  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  if (!result.count) return { message: "Die Veranstaltung hat noch Buchungen oder Plattformzuordnungen oder existiert nicht in dieser Company." };

 } catch (error) { return failure(error); }

 await deliverPendingVenueConfirmations();
 refresh(slug);

 return { success: true, message: "Veranstaltung wurde gelöscht." };



  });

}



export async function sendTrainerInfo(slug: string, id: string, requestId: string, _previous: TrainerReminderActionState): Promise<TrainerReminderActionState> {

  void _previous;

  return withSessionAudit("company/[companyKey]/events.sendTrainerInfo", async () => {

 try {

  const { company } = await requireCompanyAccess(slug);

  if (!validId(id)) return { message: "Ungültige Veranstaltung." };

  const result = await requestTrainerReminderNow(id, company.id, requestId);

  if (!result.available) return { message: "Die veröffentlichte Veranstaltung ist nicht versandbereit. Prüfe Beginn und Trainerzuordnung." };

  refresh(slug);

  if (result.sent) return { success: true, sent: true, sentAt: result.sentAt, message: "Trainer-Info wurde versendet." };

  return { sent: false, message: "Der Versand wurde beauftragt, konnte aber noch nicht für alle Trainer abgeschlossen werden. Der Cron versucht es erneut." };

 } catch (error) { return { message: failure(error).message }; }



  });

}

