import { queueVenueConfirmations } from "@/lib/venues/confirmation";
import { synchronizeTrainerConfirmation } from "@/lib/trainers/confirmation";

import { TaxError } from "@/lib/taxes/service";

import { Prisma } from "@prisma/client";

import { getPrisma } from "@/lib/db/prisma";

import type { EventInput } from "./validate-event";



export class EventMutationError extends Error {}



function assertEventId(id: string) {

  if (typeof id !== "string" || !id.trim()) {

    throw new EventMutationError("Eine gültige Veranstaltungs-ID ist erforderlich.");

  }

}



export function saveEventChanges(id: string, data: EventInput) {

  assertEventId(id);

  return getPrisma().$transaction(async tx => {

    const event = await tx.event.update({ where: { id }, data });

    await synchronizeTrainerConfirmation(tx, id);

    return event;

  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

}



export async function removeEvent(id: string) {

  // Never let a missing action argument become an unfiltered deleteMany.

  assertEventId(id);

  const prisma = getPrisma();

  // Relations are checked within the DELETE, not just in a preceding UI query.

  // Existing Restrict foreign keys also protect against concurrent relation inserts.

  const result = await prisma.$transaction(async tx => {
    const approval = await tx.eventVenueApproval.findUnique({ where: { eventId: id }, select: { batchId: true } });
    const result = await tx.event.deleteMany({ where: { id, bookings: { none: {} }, platformEvents: { none: {} } } });
    if (result.count && approval?.batchId) {
      const peer = await tx.eventVenueApproval.findFirst({ where: { batchId: approval.batchId }, select: { eventId: true } });
      if (peer) await queueVenueConfirmations(tx, [peer.eventId]);
    }
    return result;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  if (result.count === 0) {

    const event = await prisma.event.findUnique({ where: { id }, select: { id: true } });

    throw new EventMutationError(event

      ? "Diese Veranstaltung kann nicht gelöscht werden, da Buchungen oder Plattformzuordnungen vorhanden sind."

      : "Diese Veranstaltung existiert nicht mehr.");

  }

}



export function eventMutationErrorMessage(error: unknown): string {

  if (error instanceof TaxError) return error.message;

  if (error instanceof EventMutationError) return error.message;

  if (error instanceof Prisma.PrismaClientKnownRequestError) {

    if (error.code === "P2025") return "Diese Veranstaltung existiert nicht mehr.";

    if (error.code === "P2003") return "Diese Veranstaltung kann nicht gelöscht werden, da Buchungen oder Plattformzuordnungen vorhanden sind.";

  }

  return "Die Änderung konnte nicht gespeichert werden. Bitte versuche es erneut.";

}

