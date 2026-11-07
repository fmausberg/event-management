import "server-only";
import { auth } from "@/auth";
import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/db/prisma";
import { MemberAccessError } from "@/lib/companies/members";
import { noteContentSchema, noteIdSchema, noteTargetSchema, type NoteTarget } from "./validation";

export class NoteAccessError extends Error {
  constructor() { super("Die Notiz oder das Objekt ist nicht verfügbar."); }
}

// Only display identity is returned; no roles or other account details.
const noteSelect = {
  id: true, number: true, body: true, visibility: true, createdAt: true, updatedAt: true,
  author: { select: { id: true, name: true, email: true } },
} satisfies Prisma.NoteSelect;

function access(userId: string) {
  const company: Prisma.CompanyWhereInput = { memberships: { some: {
    userId, status: "ACTIVE", role: { in: ["COMPANY_USER", "COMPANY_ADMIN"] },
  } } };
  const event: Prisma.EventWhereInput = { company };
  const booking: Prisma.BookingWhereInput = { event };
  return {
    event,
    eventSeries: { company } satisfies Prisma.EventSeriesWhereInput,
    // Shared venues: ownership and companies using the venue through existing relations.
    venue: { OR: [{ company }, { events: { some: event } }, { suggestedForSeries: { some: { company } } }] } satisfies Prisma.VenueWhereInput,
    booking,
    ticket: { booking } satisfies Prisma.TicketWhereInput,
    trainer: { company } satisfies Prisma.TrainerWhereInput,
    cancellationRequest: { booking } satisfies Prisma.CancellationRequestWhereInput,
  };
}

function visibleWhere(userId: string): Prisma.NoteWhereInput {
  const allowed = access(userId);
  return { AND: [
    { OR: [{ visibility: "COMPANY" }, { authorId: userId }] },
    { OR: [
      { event: allowed.event }, { eventSeries: allowed.eventSeries }, { venue: allowed.venue },
      { booking: allowed.booking }, { ticket: allowed.ticket }, { trainer: allowed.trainer },
      { cancellationRequest: allowed.cancellationRequest },
    ] },
  ] };
}

function targetWhere(target: NoteTarget): Prisma.NoteWhereInput {
  return { [`${target.type}Id`]: target.id };
}

async function withActor<T>(work: (tx: Prisma.TransactionClient, userId: string) => Promise<T>) {
  const userId = (await auth())?.user?.id;
  if (!userId) throw new MemberAccessError("UNAUTHENTICATED");
  // Keep authorization and writes in the same serializable transaction, including creation.
  return getPrisma().$transaction((tx) => work(tx, userId), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function requireTarget(tx: Prisma.TransactionClient, userId: string, target: NoteTarget) {
  const allowed = access(userId);
  const select = { id: true };
  let row: { id: string } | null;
  switch (target.type) {
    case "event": row = await tx.event.findFirst({ where: { id: target.id, ...allowed.event }, select }); break;
    case "eventSeries": row = await tx.eventSeries.findFirst({ where: { id: target.id, ...allowed.eventSeries }, select }); break;
    case "venue": row = await tx.venue.findFirst({ where: { id: target.id, ...allowed.venue }, select }); break;
    case "booking": row = await tx.booking.findFirst({ where: { id: target.id, ...allowed.booking }, select }); break;
    case "ticket": row = await tx.ticket.findFirst({ where: { id: target.id, ...allowed.ticket }, select }); break;
    case "trainer": row = await tx.trainer.findFirst({ where: { id: target.id, ...allowed.trainer }, select }); break;
    case "cancellationRequest": row = await tx.cancellationRequest.findFirst({ where: { id: target.id, ...allowed.cancellationRequest }, select }); break;
  }
  if (!row) throw new NoteAccessError();
}

export async function createNote(targetInput: unknown, contentInput: unknown) {
  const target = noteTargetSchema.parse(targetInput);
  const content = noteContentSchema.parse(contentInput);
  return withActor(async (tx, userId) => {
    await requireTarget(tx, userId, target);
    // Only this one validated FK is accepted; identity and timestamps are server-owned.
    const data: Prisma.NoteUncheckedCreateInput = { ...content, authorId: userId, [`${target.type}Id`]: target.id };
    return tx.note.create({ data, select: noteSelect });
  });
}

export async function listNotes(targetInput: unknown) {
  const target = noteTargetSchema.parse(targetInput);
  return withActor(async (tx, userId) => {
    await requireTarget(tx, userId, target);
    return tx.note.findMany({
      where: { AND: [targetWhere(target), visibleWhere(userId)] },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: noteSelect,
    });
  });
}

export async function updateNote(idInput: unknown, contentInput: unknown) {
  const id = noteIdSchema.parse(idInput);
  const content = noteContentSchema.parse(contentInput);
  return withActor(async (tx, userId) => {
    const where: Prisma.NoteWhereInput = { id, authorId: userId, AND: [visibleWhere(userId)] };
    const result = await tx.note.updateMany({ where, data: content });
    if (!result.count) throw new NoteAccessError();
    return tx.note.findFirstOrThrow({ where, select: noteSelect });
  });
}

export async function deleteNote(idInput: unknown) {
  const id = noteIdSchema.parse(idInput);
  return withActor(async (tx, userId) => {
    // All authorized members may delete COMPANY notes; PRIVATE notes remain author-only.
    const result = await tx.note.deleteMany({ where: { id, AND: [visibleWhere(userId)] } });
    if (!result.count) throw new NoteAccessError();
  });
}


// Two batched queries regardless of row count; never fetch private bodies for counts.
export async function getNoteSummaries(type: NoteTarget["type"], ids: string[]) {
  const userId = (await auth())?.user?.id;
  if (!userId || !ids.length) return { userId: userId ?? "", counts: {} as Record<string, number> };
  const allowed = access(userId);
  const db = getPrisma();
  const id = { in: ids };
  const select = { id: true };
  let objects: { id: string }[];
  switch (type) {
    case "event": objects = await db.event.findMany({ where: { id, ...allowed.event }, select }); break;
    case "eventSeries": objects = await db.eventSeries.findMany({ where: { id, ...allowed.eventSeries }, select }); break;
    case "venue": objects = await db.venue.findMany({ where: { id, ...allowed.venue }, select }); break;
    case "booking": objects = await db.booking.findMany({ where: { id, ...allowed.booking }, select }); break;
    case "ticket": objects = await db.ticket.findMany({ where: { id, ...allowed.ticket }, select }); break;
    case "trainer": objects = await db.trainer.findMany({ where: { id, ...allowed.trainer }, select }); break;
    case "cancellationRequest": objects = await db.cancellationRequest.findMany({ where: { id, ...allowed.cancellationRequest }, select }); break;
  }
  const counts: Record<string, number> = Object.fromEntries(objects.map(row => [row.id, 0]));
  if (!objects.length) return { userId, counts };
  const field = `${type}Id` as "eventId" | "eventSeriesId" | "venueId" | "bookingId" | "ticketId" | "trainerId" | "cancellationRequestId";
  const notes = await db.note.groupBy({
    by: [field],
    where: { AND: [{ [field]: { in: objects.map(row => row.id) } }, visibleWhere(userId)] },
    _count: { _all: true },
  });
  for (const note of notes) {
    const targetId = note[field];
    if (targetId) counts[targetId] = note._count._all;
  }
  return { userId, counts };
}
