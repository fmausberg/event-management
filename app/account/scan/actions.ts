"use server";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { getPrisma } from "@/lib/db/prisma";

export type ScanResult = { message?: string; ticket?: {
 number: number; eventName: string; beginsAt: string; venue: string | null;
 status: string; checkedInAt: string | null; canRedeem: boolean;
} };

async function processTicket(token: string, redeem: boolean): Promise<ScanResult> {
 const session = await auth();
 const userId = session?.user?.id;
 if (!userId) return { message: "Bitte melde dich an." };
 if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return { message: "Ticket nicht verfügbar." };
 try {
  const db = getPrisma();
  const now = Date.now();
  const window = Math.floor(now / 60000);
  const key = `ticket-scan:${window}:${userId}`;
  await db.authRateLimit.deleteMany({ where: { expiresAt: { lte: new Date(now) } } });
  const limit = await db.authRateLimit.upsert({ where: { key }, create: { key, attempts: 1, expiresAt: new Date((window + 1) * 60000) }, update: { attempts: { increment: 1 } } });
  if (limit.attempts > 120) return { message: "Zu viele Anfragen. Bitte in einer Minute erneut versuchen." };
  return await db.$transaction(async (tx): Promise<ScanResult> => {
   const ticket = await tx.ticket.findUnique({
    where: { publicTokenHash: createHash("sha256").update(token).digest("hex") },
    select: { id: true, number: true, status: true, checkedInAt: true, booking: { select: {
     status: true, event: { select: { name: true, beginsAt: true, status: true,
      staff: { where: { userId }, select: { id: true } },
      venue: { select: { name: true, city: true, staff: { where: { userId }, select: { id: true } } } },
     } },
    } } },
   });
   if (!ticket) return { message: "Ticket nicht verfügbar." };
   const event = ticket.booking.event;
   const allowed = event.staff.length > 0 || (event.venue?.staff.length ?? 0) > 0;
   const cancelled = ticket.status === "CANCELLED" || ticket.booking.status === "CANCELLED" || event.status === "CANCELLED";
   let checkedInAt = ticket.checkedInAt;
   let message = !allowed ? "Du darfst dieses Ticket nicht einlösen. Du bist weder EventStaff dieses Events noch VenueStaff seiner Venue." : undefined;
   if (redeem && allowed && !cancelled && !checkedInAt) {
    const timestamp = new Date();
    const result = await tx.ticket.updateMany({
     where: { id: ticket.id, status: "VALID", checkedInAt: null, booking: { status: "CONFIRMED", event: { status: { not: "CANCELLED" }, OR: [
      { staff: { some: { userId } } }, { venue: { staff: { some: { userId } } } },
     ] } } },
     data: { checkedInAt: timestamp, checkedInById: userId },
    });
    if (!result.count) return { message: "Ticket oder Berechtigung hat sich geändert. Bitte erneut scannen." };
    checkedInAt = timestamp;
    message = "Ticket erfolgreich eingelöst.";
   } else if (redeem && allowed) message = cancelled ? "Dieses Ticket ist storniert." : "Dieses Ticket wurde bereits eingelöst.";
   return { message, ticket: { number: ticket.number, eventName: event.name, beginsAt: event.beginsAt.toISOString(), venue: event.venue ? [event.venue.name, event.venue.city].filter(Boolean).join(", ") : null,
    status: cancelled ? "Storniert" : checkedInAt ? "Bereits eingelöst" : "Gültig", checkedInAt: checkedInAt?.toISOString() ?? null, canRedeem: allowed && !cancelled && !checkedInAt,
   } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
 } catch (error) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return { message: "Das Ticket wurde gleichzeitig geändert. Bitte erneut scannen." };
  return { message: "Ticket konnte nicht verarbeitet werden. Bitte erneut scannen und den Status prüfen." };
 }
}
export async function inspectTicket(token: string) { return processTicket(token, false); }
export async function redeemTicket(token: string) { return processTicket(token, true); }
