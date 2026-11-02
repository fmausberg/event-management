import "server-only";
import type { Prisma } from "@prisma/client";
import { addCalendarDays, berlinCalendarDate } from "./batch-schedule";
import { parseBerlinDateTime } from "@/lib/events/berlin-date-time";

export async function occupiedSeriesDates(db: Pick<Prisma.TransactionClient, "event">, companyId: string, seriesId: string, from: string, to: string) {
  const events = await db.event.findMany({ where: { companyId, eventSeriesId: seriesId, beginsAt: {
    gte: parseBerlinDateTime(`${from}T00:00`), lt: parseBerlinDateTime(`${addCalendarDays(to, 1)}T00:00`),
  } }, select: { beginsAt: true } });
  return [...new Set(events.flatMap(event => event.beginsAt ? [berlinCalendarDate(event.beginsAt)] : []))].sort();
}
