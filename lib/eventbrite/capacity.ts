import "server-only";
import { z } from "zod";
import { getPrisma } from "@/lib/db/prisma";
import { decrypt } from "./connection";
import { eventbriteCapacityTarget, nonEventbriteReservations } from "./capacity-model";

class CapacityError extends Error {}
const remoteId = z.string().regex(/^\d+$/);
const count = z.number().int().nonnegative();

async function api(token: string, path: string, deadline: number, body?: unknown): Promise<unknown> {
  if (Date.now() >= deadline) throw new CapacityError("Eventbrite-Kontingentabgleich hat zu lange gedauert. Er wird erneut versucht.");
  let response: Response;
  try {
    response = await fetch(`https://www.eventbriteapi.com/v3/${path}`, {
      method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(Math.max(1, Math.min(15_000, deadline - Date.now()))),
    });
  } catch { throw new CapacityError("Eventbrite ist nicht erreichbar. Der Kontingentabgleich wird erneut versucht."); }
  if (!response.ok) throw new CapacityError(`Eventbrite hat den Kontingentabgleich abgewiesen (HTTP ${response.status}). Bitte Verbindung und Eventbrite-Bestand prüfen.`);
  try { return await response.json(); } catch { throw new CapacityError("Eventbrite hat keinen prüfbaren Kontingentstand geliefert."); }
}

/** Durable queue is populated by DB triggers. HTTP writes happen only after the
 * originating booking commit, serialized across instances with an advisory lock.
 */
export async function deliverPendingEventbriteCapacity(options: { eventId?: string; companyId?: string; take?: number } = {}) {
  const db = getPrisma();
  const jobs = await db.eventbriteCapacitySync.findMany({ where: {
    ...(options.eventId ? { eventId: options.eventId } : {}), retryAt: { lte: new Date() },
    event: { status: "PUBLISHED", endsAt: { gt: new Date() }, ...(options.companyId ? { companyId: options.companyId } : {}) },
  }, orderBy: [{ retryAt: "asc" }, { eventId: "asc" }], take: options.take ?? 5, select: { eventId: true, revision: true } });
  let failures = 0;
  for (const candidate of jobs) {
    try {
      failures += await db.$transaction(async tx => {
        const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(190722, hashtext(${candidate.eventId})) AS locked`;
        if (!lock?.locked) return 0;
        const job = await tx.eventbriteCapacitySync.findUnique({ where: { eventId: candidate.eventId } });
        if (!job?.retryAt || job.retryAt > new Date()) return 0;
        try {
          const event = await tx.event.findUniqueOrThrow({ where: { id: job.eventId }, include: { eventbritePublication: true } });
          const publication = event.eventbritePublication;
          if (event.status !== "PUBLISHED" || !event.postToEventbrite || !event.endsAt || event.endsAt <= new Date()) return 0;
          if (!publication || publication.status !== "PUBLISHED" || !publication.externalEventId || !publication.ticketClassId) throw new CapacityError("Für den Kontingentabgleich fehlt die veröffentlichte Eventbrite-Zuordnung mit Ticketklasse.");
          if (event.maxSeats === null) throw new CapacityError("Bitte ein Ticketkontingent für dieses Event festlegen.");
          const connection = await tx.eventbriteConnection.findUnique({ where: { companyId: event.companyId } });
          if (!connection || connection.status !== "CONNECTED" || connection.organizationId !== publication.organizationId) throw new CapacityError("Die ursprüngliche Eventbrite-Organisation ist nicht mehr verbunden.");
          if (!remoteId.safeParse(publication.externalEventId).success || !remoteId.safeParse(publication.ticketClassId).success) throw new CapacityError("Die gespeicherten Eventbrite-IDs sind ungültig.");
          const reservations = await tx.booking.aggregate({ where: nonEventbriteReservations(event.id), _sum: { quantity: true } });
          const target = eventbriteCapacityTarget(event.maxSeats, reservations._sum.quantity ?? 0);
          const token = decrypt(connection.encryptedAccessToken, event.companyId);
          const deadline = Date.now() + 20_000;
          const path = `events/${publication.externalEventId}/`;
          const remote = z.object({ id: remoteId, organization_id: remoteId, status: z.string(), is_reserved_seating: z.boolean().optional() }).parse(await api(token, path, deadline));
          if (remote.id !== publication.externalEventId || remote.organization_id !== connection.organizationId) throw new CapacityError("Das Eventbrite-Event gehört nicht zur verbundenen Organisation.");
          if (!["live", "started"].includes(remote.status)) throw new CapacityError("Das Eventbrite-Event ist nicht im Verkauf. Änderungen und Absagen bitte direkt in Eventbrite prüfen.");
          if (remote.is_reserved_seating) throw new CapacityError("Reservierte Sitzplätze werden vom Kontingentabgleich nicht unterstützt.");
          const tier = z.object({ capacity_total: count, capacity_sold: count, capacity_pending: count, holds: z.array(z.unknown()).nullish().transform(value => value ?? []) }).parse(await api(token, `${path}capacity_tier/`, deadline));
          if (tier.holds.length) throw new CapacityError("Eventbrite-Kapazitätsblöcke wurden manuell eingerichtet. Bitte vor dem Abgleich prüfen.");
          const ticketPath = `${path}ticket_classes/${publication.ticketClassId}/`;
          const ticket = z.object({ id: remoteId, capacity: count, inventory_tier_id: z.string().nullish() }).parse(await api(token, ticketPath, deadline));
          if (ticket.id !== publication.ticketClassId || ticket.inventory_tier_id) throw new CapacityError("Die Eventbrite-Ticketklasse wurde verändert. Bitte deren Kontingent prüfen.");
          // Never set a capacity below already sold/pending tickets. Closing the
          // remaining stock at that floor is safe; an overbooking remains visible.
          const occupied = tier.capacity_sold + tier.capacity_pending;
          const capacity = Math.max(target, occupied);
          const ticketCapacity = Math.max(1, event.maxSeats, occupied);
          const latest = await tx.eventbriteCapacitySync.findUniqueOrThrow({ where: { eventId: event.id }, select: { revision: true } });
          if (latest.revision !== job.revision) return 0;
          const current = await tx.event.findUniqueOrThrow({ where: { id: event.id }, select: { status: true, updatedAt: true } });
          const currentConnection = await tx.eventbriteConnection.findUnique({ where: { companyId: event.companyId } });
          if (current.status !== "PUBLISHED" || current.updatedAt.getTime() !== event.updatedAt.getTime() || currentConnection?.updatedAt.getTime() !== connection.updatedAt.getTime()) throw new CapacityError("Event oder Verbindung wurden während des Kontingentabgleichs geändert. Der Abgleich wird erneut versucht.");
          const setEventCapacity = async () => {
            if (capacity === tier.capacity_total) return;
            const updated = z.object({ capacity_total: count }).parse(await api(token, `${path}capacity_tier/`, deadline, { capacity_tier: { capacity_total: capacity } }));
            if (updated.capacity_total !== capacity) throw new CapacityError("Eventbrite hat das neue Gesamtkontingent nicht bestätigt.");
          };
          const setTicketCapacity = async () => {
            if (ticket.capacity === ticketCapacity) return;
            const updated = z.object({ id: remoteId, capacity: count }).parse(await api(token, ticketPath, deadline, { ticket_class: { capacity: ticketCapacity } }));
            if (updated.id !== ticket.id || updated.capacity !== ticketCapacity) throw new CapacityError("Eventbrite hat das neue Ticketkontingent nicht bestätigt.");
          };
          // Keep the stricter event limit in place during both halves of an update.
          if (capacity <= tier.capacity_total) { await setEventCapacity(); await setTicketCapacity(); }
          else { await setTicketCapacity(); await setEventCapacity(); }
          if (occupied > target) {
            await tx.eventbriteCapacitySync.update({ where: { eventId: event.id }, data: { lastCapacity: capacity, lastError: "Eventbrite hat bereits mehr Tickets verkauft oder reserviert als im gemeinsamen Kontingent frei sind. Weitere Verkäufe sind begrenzt; bitte den Bestand prüfen.", retryAt: new Date(Date.now() + 60_000) } });
            return 1;
          }
          const data = { syncedRevision: job.revision, lastCapacity: capacity, lastSyncedAt: new Date(), lastError: null };
          const clean = await tx.eventbriteCapacitySync.updateMany({ where: { eventId: event.id, revision: job.revision }, data: { ...data, retryAt: null } });
          // A booking committed during the HTTP request: retain its pending work.
          if (!clean.count) await tx.eventbriteCapacitySync.update({ where: { eventId: event.id }, data });
          return 0;
        } catch (error) {
          await tx.eventbriteCapacitySync.update({ where: { eventId: job.eventId }, data: {
            lastError: error instanceof CapacityError ? error.message : "Der Eventbrite-Kontingentabgleich ist fehlgeschlagen. Bitte Konfiguration und Kontingent prüfen.",
            retryAt: new Date(Date.now() + 60_000),
          } });
          return 1;
        }
      }, { timeout: 25_000 });
    } catch {
      failures++;
      await db.eventbriteCapacitySync.updateMany({ where: { eventId: candidate.eventId, revision: candidate.revision, syncedRevision: { lt: candidate.revision } }, data: {
        lastError: "Der Eventbrite-Kontingentabgleich wurde unterbrochen und wird erneut versucht.", retryAt: new Date(Date.now() + 60_000),
      } }).catch(() => {});
    }
  }
  return { checked: jobs.length, failures };
}
