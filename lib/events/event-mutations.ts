import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/db/prisma";
import type { EventInput } from "./validate-event";

export class EventMutationError extends Error {}

function assertEventId(id: string) {
  if (typeof id !== "string" || !id.trim()) {
    throw new EventMutationError("Eine gültige Event-ID ist erforderlich.");
  }
}

export function insertEvent(data: EventInput) {
  // number and timestamps are assigned by PostgreSQL/Prisma.
  return getPrisma().event.create({ data });
}

export function saveEventChanges(id: string, data: EventInput) {
  assertEventId(id);
  return getPrisma().event.update({ where: { id }, data });
}

export async function removeEvent(id: string) {
  // Never let a missing action argument become an unfiltered deleteMany.
  assertEventId(id);
  const prisma = getPrisma();
  // Relations are checked within the DELETE, not just in a preceding UI query.
  // Existing Restrict foreign keys also protect against concurrent relation inserts.
  const result = await prisma.event.deleteMany({
    where: { id, bookings: { none: {} }, platformEvents: { none: {} } },
  });
  if (result.count === 0) {
    const event = await prisma.event.findUnique({ where: { id }, select: { id: true } });
    throw new EventMutationError(event
      ? "Dieses Event kann nicht gelöscht werden, da Buchungen oder Plattformzuordnungen vorhanden sind."
      : "Dieses Event existiert nicht mehr.");
  }
}

export function eventMutationErrorMessage(error: unknown): string {
  if (error instanceof EventMutationError) return error.message;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2025") return "Dieses Event existiert nicht mehr.";
    if (error.code === "P2003") return "Dieses Event kann nicht gelöscht werden, da Buchungen oder Plattformzuordnungen vorhanden sind.";
  }
  return "Die Änderung konnte nicht gespeichert werden. Bitte versuche es erneut.";
}
