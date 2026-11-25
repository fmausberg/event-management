import { eligibleVenueApprovalMember } from "@/lib/venues/approval-members";
import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/lib/db/prisma";
import { accountOrigin } from "@/lib/auth/verification";
import { resolveEventTax } from "@/lib/taxes/service";
import { companyRecipients, type CompanyMessage } from "@/lib/companies/notifications";
import { encryptPaymentMail } from "@/lib/payments/mail";
import { venueConfirmationMessage, venueIssueMessage, type EventFacts } from "@/lib/mail/templates/trainer-confirmation";

export class VenueConfirmationError extends Error {}
const activeStatuses = ["PUBLISHED", "PENDING_TRAINER_CONFIRMATION", "PENDING_VENUE_CONFIRMATION"] as const;
const includeEvent = { company: { select: { slug: true, name: true } }, venue: { include: { staff: { where: eligibleVenueApprovalMember, include: { user: { select: { email: true } } } } } }, trainers: { select: { responseStatus: true } } } as const;
function facts(event: Prisma.EventGetPayload<{ include: typeof includeEvent }>): EventFacts {
  const venue = event.venue;
  return { name: event.name, beginsAt: event.beginsAt, endsAt: event.endsAt, company: event.company.name,
    venue: venue ? [venue.name, venue.addressLine1, venue.addressLine2, [venue.postalCode, venue.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "Noch offen" };
}
const issueSchema = z.string().trim().min(1, "Bitte beschreibe das Problem.").max(20000, "Bitte verwende höchstens 20000 Zeichen.");
const requestIdSchema = z.uuid();

/** New events explicitly opt into the new stage; old published events keep their approval. */
export async function initializeVenueApprovals(tx: Prisma.TransactionClient, eventIds: string[], preapproved = false, actorId?: string, batchId?: string) {
  const events = await tx.event.findMany({ where: { id: { in: eventIds } }, select: { id: true, venueId: true, venue: { select: { _count: { select: { staff: { where: eligibleVenueApprovalMember } } } } } } });
  await tx.eventVenueApproval.createMany({ data: events.map(event => {
    const accepted = preapproved || !event.venue?._count.staff;
    return { eventId: event.id, venueId: event.venueId, batchId: batchId ?? null,
      status: accepted ? "ACCEPTED" as const : "PENDING" as const, manual: preapproved,
      respondedAt: accepted ? new Date() : null, respondedById: preapproved ? actorId ?? null : null };
  }), skipDuplicates: true });
  if (preapproved && actorId) await tx.note.createMany({ data: events.map(event => ({ eventId: event.id, authorId: actorId, visibility: "COMPANY" as const,
    body: "Ortsfreigabe bereits erfolgt: Das erstellende Company-Mitglied hat die vorherige Zustimmung des Ortsteams bestätigt." })) });
}

export async function ensureVenueApproval(tx: Prisma.TransactionClient, eventId: string) {
  const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { id: true, status: true, venueId: true, venueApproval: true, venue: { select: { _count: { select: { staff: { where: eligibleVenueApprovalMember } } } } } } });
  let approval = event.venueApproval;
  const changedVenue = !!approval && approval.venueId !== event.venueId;
  if (changedVenue) { await tx.eventVenueApproval.delete({ where: { id: approval!.id } }); approval = null; }
  if (!approval) {
    const accepted = !event.venue?._count.staff || !changedVenue && ["PUBLISHED", "CANCELLED", "COMPLETED"].includes(event.status);
    approval = await tx.eventVenueApproval.create({ data: { eventId, venueId: event.venueId, status: accepted ? "ACCEPTED" : "PENDING", respondedAt: accepted ? new Date() : null } });
  } else if (!event.venue?._count.staff && approval.status !== "ACCEPTED") {
    approval = await tx.eventVenueApproval.update({ where: { id: approval.id }, data: { status: "ACCEPTED", respondedAt: new Date(), respondedById: null, manual: false } });
  }
  return approval;
}

/** Stage two starts only when every current trainer has accepted. */
export async function synchronizeVenueConfirmation(tx: Prisma.TransactionClient, eventId: string, notify = true) {
  const approval = await ensureVenueApproval(tx, eventId);
  const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { status: true, trainers: { select: { responseStatus: true } } } });
  if (!(activeStatuses as readonly string[]).includes(event.status)) return;
  const trainerPending = event.trainers.some(trainer => trainer.responseStatus !== "ACCEPTED");
  const status = trainerPending ? "PENDING_TRAINER_CONFIRMATION" : approval.status === "ACCEPTED" ? "PUBLISHED" : "PENDING_VENUE_CONFIRMATION";
  if (status === "PUBLISHED") await resolveEventTax(tx, eventId);
  if (event.status !== status) await tx.event.update({ where: { id: eventId }, data: { status } });
  if (status === "PENDING_VENUE_CONFIRMATION" && notify) await queueVenueConfirmations(tx, [eventId]);
}

/** Batch events retain their group while trainer replies arrive in separate requests. */
export async function queueVenueConfirmations(tx: Prisma.TransactionClient, eventIds: string[]) {
  const seeds = await tx.eventVenueApproval.findMany({ where: { eventId: { in: eventIds } }, select: { id: true, batchId: true } });
  const groups = new Map(seeds.map(seed => [seed.batchId ?? seed.id, seed]));
  for (const [key, seed] of groups) {
    const rows = await tx.eventVenueApproval.findMany({ where: {
      ...(seed.batchId ? { batchId: seed.batchId } : { id: seed.id }),
      event: { status: { in: [...activeStatuses] }, endsAt: { gt: new Date() } },
    }, include: { event: { include: includeEvent } }, orderBy: [{ event: { beginsAt: "asc" } }, { id: "asc" }] });
    // One list for the whole creation batch, after stage one is complete.
    if (rows.some(row => row.event.trainers.some(trainer => trainer.responseStatus !== "ACCEPTED"))) continue;
    const pending = rows.filter(row => row.status === "PENDING" && !row.manual && row.respondedAt === null && row.venueId === row.event.venueId);
    const recipients = new Map<string, typeof pending>();
    for (const row of pending) for (const member of row.event.venue?.staff ?? []) {
      const to = member.user?.email.trim().toLowerCase();
      if (!to) continue;
      const group = recipients.get(to) ?? [];
      if (!group.some(item => item.id === row.id)) group.push(row);
      recipients.set(to, group);
    }
    for (const [to, group] of recipients) {
      const message = { to, ...venueConfirmationMessage(group.map(row => facts(row.event)), `${accountOrigin()}/account/eventmanagement`),
        venueConfirmation: { approvalIds: group.map(row => row.id), companyId: group[0].event.companyId } };
      const requestKey = `venue-confirmation:${key}:${to}`;
      await tx.mailOutbox.upsert({ where: { requestKey }, create: { requestKey, kind: "VENUE_CONFIRMATION", encryptedMessage: encryptPaymentMail(message) }, update: {} });
    }
  }
}

export async function currentVenueConfirmation(tx: Prisma.TransactionClient, approvalIds: string[], companyId: string, to: string, now: Date) {
  const rows = await tx.eventVenueApproval.findMany({ where: { id: { in: approvalIds }, status: "PENDING", manual: false, respondedAt: null,
    event: { companyId, status: { in: [...activeStatuses] }, endsAt: { gt: now } } }, include: { event: { include: includeEvent } }, orderBy: [{ event: { beginsAt: "asc" } }, { id: "asc" }] });
  const current = rows.filter(row => row.venueId === row.event.venueId && row.event.venue?.staff.some(member => member.user?.email.trim().toLowerCase() === to.trim().toLowerCase()));
  if (!current.length) return null;
  if (current.some(row => row.event.trainers.some(trainer => trainer.responseStatus !== "ACCEPTED"))) throw new Error("Venue request deferred until trainer approval");
  return venueConfirmationMessage(current.map(row => facts(row.event)), `${accountOrigin()}/account/eventmanagement`);
}

const companyChangeSchema = z.object({ id: z.string().min(1).max(191).nullable(), venueId: z.string().max(191).nullable(), status: z.enum(["PENDING", "ACCEPTED"]), expectedStatus: z.enum(["PENDING", "ACCEPTED", "ISSUE"]), expectedUpdatedAt: z.iso.datetime().nullable() }).strict();
export type CompanyVenueChange = z.infer<typeof companyChangeSchema>;
export function readCompanyVenueChange(value: unknown): CompanyVenueChange | null {
  if (value === null || value === "") return null;
  try { if (typeof value !== "string" || value.length > 2000) throw new Error(); return companyChangeSchema.parse(JSON.parse(value)); }
  catch { throw new VenueConfirmationError("Die Ortsfreigabe ist ungültig. Bitte lade die Seite neu."); }
}
export async function applyCompanyVenueChange(tx: Prisma.TransactionClient, companyId: string, eventId: string, userId: string, change: CompanyVenueChange) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true, emailVerified: true } });
  if (!user?.emailVerified || user.role !== "ADMIN" && !await tx.companyMembership.findFirst({ where: { companyId, userId, status: "ACTIVE" }, select: { id: true } })) throw new VenueConfirmationError("Du darfst diese Ortsfreigabe nicht bearbeiten.");
  const event = await tx.event.findFirst({ where: { id: eventId, companyId }, include: { venueApproval: true, venue: { select: { _count: { select: { staff: { where: eligibleVenueApprovalMember } } } } } } });
  if (!event || !(["DRAFT", ...activeStatuses] as readonly string[]).includes(event.status) || event.endsAt && event.endsAt <= new Date() && event.status !== "DRAFT") throw new VenueConfirmationError("Dieses Event kann nicht mehr freigegeben werden.");
  if (event.venueId !== change.venueId || event.venueApproval?.id !== (change.id ?? undefined) || event.venueApproval && (event.venueApproval.status !== change.expectedStatus || event.venueApproval.updatedAt.toISOString() !== change.expectedUpdatedAt)) throw new VenueConfirmationError("Ort oder Ortsfreigabe wurden inzwischen geändert. Bitte lade die Seite neu.");
  if (!event.venue?._count.staff && change.status === "PENDING") throw new VenueConfirmationError("Ohne Ortsteam mit verifiziertem Account ist die Ortsfreigabe automatisch erteilt.");
  const approval = await ensureVenueApproval(tx, eventId);
  await tx.eventVenueApproval.update({ where: { id: approval.id }, data: { status: change.status, manual: true, respondedAt: new Date(), respondedById: userId } });
}

export async function respondToVenueApproval(userId: string, approvalId: string, response: "ACCEPTED" | "ISSUE", body: unknown, requestId: unknown, version: unknown) {
  if (typeof approvalId !== "string" || !approvalId.trim() || approvalId.length > 191 || !["ACCEPTED", "ISSUE"].includes(response) || !z.iso.datetime().safeParse(version).success) throw new VenueConfirmationError("Ungültige Ortsfreigabe.");
  const issue = response === "ISSUE" ? issueSchema.safeParse(body) : null;
  if (issue && !issue.success) throw new VenueConfirmationError(issue.error.issues[0].message);
  if (response === "ISSUE" && !requestIdSchema.safeParse(requestId).success) throw new VenueConfirmationError("Bitte öffne das Problemformular erneut.");
  const noteId = response === "ISSUE" ? `venue-issue:${approvalId}:${requestId}` : null;
  const legacyEventId = approvalId.startsWith("legacy:") ? approvalId.slice(7) : null;
  await getPrisma().$transaction(async tx => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { emailVerified: true, name: true, email: true } });
    let approval = await tx.eventVenueApproval.findUnique({ where: legacyEventId ? { eventId: legacyEventId } : { id: approvalId }, include: { event: { include: includeEvent } } });
    if (!approval && legacyEventId) {
      const legacy = await tx.event.findFirst({ where: { id: legacyEventId, status: { in: ["PUBLISHED", "CANCELLED", "COMPLETED"] }, venue: { staff: { some: { userId } } } }, select: { id: true } });
      if (!legacy || !user?.emailVerified) throw new VenueConfirmationError("Diese Ortsfreigabe ist nicht verfügbar.");
      await ensureVenueApproval(tx, legacy.id);
      approval = await tx.eventVenueApproval.findUnique({ where: { eventId: legacy.id }, include: { event: { include: includeEvent } } });
    }
    if (!user?.emailVerified || !approval || !approval.venueId || approval.venueId !== approval.event.venueId || !await tx.venueStaff.findFirst({ where: { venueId: approval.venueId, userId }, select: { id: true } })) throw new VenueConfirmationError("Diese Ortsfreigabe ist nicht verfügbar.");
    if (approval.event.trainers.some(trainer => trainer.responseStatus !== "ACCEPTED") && !await tx.eventTrainer.findFirst({ where: { eventId: approval.eventId, trainer: { userId, companyId: approval.event.companyId } }, select: { id: true } })) throw new VenueConfirmationError("Die Trainerfreigabe steht noch aus. Die Ortsfreigabe ist noch nicht verfügbar.");
    if (noteId) {
      const existing = await tx.note.findUnique({ where: { id: noteId }, select: { eventId: true, authorId: true, body: true } });
      if (existing) { if (existing.eventId !== approval.eventId || existing.authorId !== userId || !issue?.success || existing.body !== issue.data) throw new VenueConfirmationError("Diese Meldung wurde bereits mit anderem Inhalt gespeichert."); return; }
    }
    if ((legacyEventId ? approval.event.updatedAt : approval.updatedAt).toISOString() !== version) throw new VenueConfirmationError("Ein Mitglied hat bereits geantwortet oder die Freigabe wurde geändert. Bitte lade die Seite neu.");
    if (response === "ACCEPTED") {
      if (!["PENDING", "ISSUE"].includes(approval.status) || approval.event.status !== "PENDING_VENUE_CONFIRMATION" || approval.event.trainers.some(trainer => trainer.responseStatus !== "ACCEPTED")) throw new VenueConfirmationError("Die Ortsfreigabe ist derzeit nicht zur Bestätigung offen.");
      if (!approval.event.endsAt || approval.event.endsAt <= new Date()) throw new VenueConfirmationError("Diese Veranstaltung ist bereits beendet.");
    } else if (!(activeStatuses as readonly string[]).includes(approval.event.status) && !["CANCELLED", "COMPLETED"].includes(approval.event.status)) throw new VenueConfirmationError("Für dieses Event kann kein Problem gemeldet werden.");
    const updated = await tx.eventVenueApproval.updateMany({ where: { id: approval.id, updatedAt: approval.updatedAt, status: approval.status }, data: { status: response, respondedAt: new Date(), respondedById: userId, manual: false } });
    if (updated.count !== 1) throw new VenueConfirmationError("Die Ortsfreigabe wurde gleichzeitig geändert. Bitte lade die Seite neu.");
    const venueDeclined = response === "ISSUE" && (activeStatuses as readonly string[]).includes(approval.event.status);
    // Touch the event to serialize team responses with Company edits and trainer replies.
    await tx.event.update({ where: { id: approval.eventId }, data: { status: venueDeclined ? "VENUE_NOT_SET" : approval.event.status, ...(venueDeclined ? { venueId: null } : {}) } });
    if (issue?.success && noteId) {
      await tx.note.create({ data: { id: noteId, eventId: approval.eventId, authorId: userId, body: issue.data, visibility: "COMPANY" } });
      for (const to of await companyRecipients(tx, approval.event.companyId, "notifyVenueIssues")) {
        const message: CompanyMessage = { to, ...venueIssueMessage(facts(approval.event), user.name, issue.data, `${accountOrigin()}/company/${encodeURIComponent(approval.event.company.slug)}/events/${encodeURIComponent(approval.eventId)}`, user.email), companyNotification: { companyId: approval.event.companyId, type: "notifyVenueIssues" } };
        const requestKey = `venue-issue:${noteId}:${to}`;
        await tx.mailOutbox.upsert({ where: { requestKey }, create: { requestKey, kind: "COMPANY_NOTIFICATION", encryptedMessage: encryptPaymentMail(message) }, update: {} });
      }
    }
    if (!venueDeclined) await synchronizeVenueConfirmation(tx, approval.eventId);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** Also cover account deletion or verification being revoked while requests wait. */
export async function reconcileVenueApprovals() {
  const db = getPrisma();
  const pending = await db.eventVenueApproval.findMany({ where: {
    status: { not: "ACCEPTED" }, event: { status: { in: [...activeStatuses] } },
    OR: [{ venueId: null }, { venue: { is: { staff: { none: eligibleVenueApprovalMember } } } }],
  }, select: { eventId: true }, take: 50, orderBy: { createdAt: "asc" } });
  let failures = 0;
  for (const row of pending) {
    try { await db.$transaction(tx => synchronizeVenueConfirmation(tx, row.eventId), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
    catch { failures++; }
  }
  return { checked: pending.length, failures };
}
