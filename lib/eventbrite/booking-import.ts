import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/lib/db/prisma";
import { requireBookingEvent } from "@/lib/bookings/management";
import { upsertExternalBookingInTransaction, type UpsertExternalBookingInput } from "@/lib/bookings/upsert-external-booking";
import { MemberAccessError } from "@/lib/companies/members";
import { decrypt, EventbriteError } from "./connection";

export class EventbriteBookingImportError extends Error {}
// Only validated code identifiers and fixed parameter labels may enter UI/errors.
// error_description can reflect request data and must never be exposed verbatim.
const providerErrorCode = z.string().max(80).regex(/^[A-Z]+(?:_[A-Z0-9]+)+$/);
const importParameters = ["status", "continuation", "event_id", "changed_since", "last_item_seen", "page", "page_size"] as const;

function providerErrorDetails(raw: unknown) {
  const result = z.object({ error: z.unknown().optional(), error_description: z.string().nullish(), error_detail: z.unknown().optional() }).safeParse(raw);
  if (!result.success) return "";
  const code = providerErrorCode.safeParse(result.data.error);
  const description = (result.data.error_description ?? "").slice(0, 4000);
  const detail = result.data.error_detail;
  const fields = importParameters.filter(field => {
    if (detail && typeof detail === "object" && !Array.isArray(detail) && Object.prototype.hasOwnProperty.call(detail, field)) return true;
    // Recognize the provider's "arguments: status - Invalid choice" shape.
    // Only the fixed field name is retained, never the following raw text/value.
    return new RegExp(`(?:^|[\\s,:;])${field}\\s*[-:]`, "i").test(description);
  });
  return `${code.success ? `, Eventbrite-Code: ${code.data}` : ""}${fields.length ? `, Parameter: ${fields.join(", ")}` : ""}`;
}

const id = z.string().regex(/^\d+$/);
const orderSchema = z.object({
  id, event_id: id, created: z.iso.datetime({ offset: true }),
  status: z.enum(["placed", "started", "pending", "abandoned", "refunded", "cancelled", "canceled", "deleted"]),
  name: z.string().max(1000).nullish(), first_name: z.string().max(1000).nullish(), last_name: z.string().max(1000).nullish(),
  email: z.union([z.email().max(254), z.literal("")]).nullish(),
});
const attendeeSchema = z.object({
  id, event_id: id, order_id: id.nullish(), guestlist_id: id.nullish(),
  cancelled: z.boolean(), refunded: z.boolean(), status: z.string().min(1),
});
const pagination = z.object({ has_more_items: z.boolean(), continuation: z.string().nullish() });
type Order = z.infer<typeof orderSchema>;
type Attendee = z.infer<typeof attendeeSchema>;
const incomplete = () => new EventbriteBookingImportError("Die Eventbrite-Daten sind unvollständig oder widersprüchlich. Es wurde nichts importiert. Bitte erneut versuchen.");

/** One booking per order; partial cancellations reduce only its active seat count. */
export function normalizeEventbriteBookings(externalEventId: string, rawOrders: unknown[], rawAttendees: unknown[]) {
  const orders = z.array(orderSchema).parse(rawOrders);
  const attendees = z.array(attendeeSchema).parse(rawAttendees);
  const orderIds = new Set<string>();
  const attendeeIds = new Set<string>();
  const grouped = new Map<string, Attendee[]>();
  for (const order of orders) {
    if (order.event_id !== externalEventId || orderIds.has(order.id)) throw incomplete();
    orderIds.add(order.id);
  }
  for (const attendee of attendees) {
    if (attendee.event_id !== externalEventId || attendeeIds.has(attendee.id)) throw incomplete();
    attendeeIds.add(attendee.id);
    if (!attendee.order_id && attendee.guestlist_id) continue;
    if (!attendee.order_id || !orderIds.has(attendee.order_id)) throw incomplete();
    const group = grouped.get(attendee.order_id) ?? [];
    group.push(attendee); grouped.set(attendee.order_id, group);
  }
  const bookings: Omit<UpsertExternalBookingInput, "eventId">[] = [];
  const cancelledWithoutTickets: Omit<UpsertExternalBookingInput, "eventId" | "quantity">[] = [];
  const pendingOrderIds: string[] = [];
  let skipped = 0;
  for (const order of orders) {
    // An abandoned or pending checkout is not a confirmed sale.
    if (["started", "pending", "abandoned"].includes(order.status)) { skipped++; pendingOrderIds.push(order.id); continue; }
    const name = (order.name?.trim() || [order.first_name, order.last_name].filter(Boolean).join(" ").trim()).slice(0, 160) || null;
    const base = { platform: "EVENTBRITE" as const, externalBookingId: order.id, bookedAt: new Date(order.created),
      customerName: name, customerEmail: order.email?.trim().toLowerCase() || null };
    const cancelled = ["refunded", "cancelled", "canceled", "deleted"].includes(order.status);
    const tickets = grouped.get(order.id);
    if (!tickets?.length && cancelled) {
      cancelledWithoutTickets.push({ ...base, status: "CANCELLED" });
      continue;
    }
    if (!tickets?.length) throw incomplete();
    let active = 0;
    let unpaid = 0;
    for (const ticket of tickets) {
      if (ticket.cancelled || ticket.refunded) continue;
      const state = ticket.status.toLowerCase().replace(/[ _]+/g, "_");
      if (state === "attending" || state === "checked_in") active++;
      else if (state === "unpaid") unpaid++;
      else if (state !== "not_attending") throw incomplete();
    }
    if (!cancelled && unpaid) {
      // Do not silently turn unpaid tickets into either a sale or cancellation.
      throw new EventbriteBookingImportError("Eventbrite enthält eine Bestellung mit unbezahlten Tickets. Bitte deren Zahlungsstatus in Eventbrite klären; es wurde nichts importiert.");
    }
    const quantity = cancelled || active === 0 ? tickets.length : active;
    bookings.push({ ...base, quantity,
      status: cancelled || active === 0 ? "CANCELLED" : "CONFIRMED",
    });
  }
  return { bookings, cancelledWithoutTickets, pendingOrderIds, skipped };
}

async function request(token: string, path: string, deadline: number): Promise<unknown> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new EventbriteBookingImportError("Der Import hat zu lange gedauert. Es wurde nichts importiert. Bitte erneut versuchen.");
  let response: Response;
  try {
    response = await fetch(`https://www.eventbriteapi.com/v3/${path}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(Math.min(15_000, remaining)),
    });
  } catch { throw new EventbriteBookingImportError("Eventbrite ist gerade nicht erreichbar. Der letzte erfolgreiche Import bleibt erhalten."); }
  if (!response.ok) {
    // Fixed labels only: never expose request URLs, tokens or provider response bodies.
    const resource = path.split("?")[0].endsWith("/orders/") ? "Bestellungen"
      : path.split("?")[0].endsWith("/attendees/") ? "Teilnehmer" : "Event";
    let providerDetails = "";
    try { providerDetails = providerErrorDetails(await response.json()); } catch { /* Keep HTTP diagnostics for non-JSON errors. */ }
    const details = `Anfrage: ${resource}, HTTP ${response.status}${providerDetails}`;
    if (response.status === 401 || response.status === 403) throw new EventbriteBookingImportError(`Der Zugriff auf die Eventbrite-Buchungen fehlt (${details}). Bitte die Verbindung und Leserechte prüfen.`);
    if (response.status === 429) throw new EventbriteBookingImportError(`Eventbrite begrenzt gerade die Anfragen (${details}). Bitte später erneut versuchen.`);
    throw new EventbriteBookingImportError(`Eventbrite konnte die Buchungen nicht liefern (${details}). Bitte bei HTTP 400 oder 404 einen Plattformadministrator kontaktieren; bei Serverfehlern später erneut versuchen.`);
  }
  try { return await response.json(); } catch { throw incomplete(); }
}

async function readPages<T>(token: string, path: string, key: "orders" | "attendees", schema: z.ZodType<T>, deadline: number) {
  const records: T[] = [];
  const seen = new Set<string>();
  let continuation: string | undefined;
  for (let page = 0; page < 100; page++) {
    const query = new URLSearchParams(key === "orders" ? { status: "both" } : {});
    if (continuation) query.set("continuation", continuation);
    const raw = await request(token, `${path}?${query}`, deadline);
    const data = z.object({ pagination }).loose().parse(raw);
    records.push(...z.array(schema).parse(data[key]));
    if (records.length > 5000) throw new EventbriteBookingImportError("Dieser Import überschreitet die Grenze von 5.000 Datensätzen. Bitte einen Plattformadministrator kontaktieren; es wurde nichts importiert.");
    if (!data.pagination.has_more_items) return records;
    const next = data.pagination.continuation;
    if (!next || seen.has(next)) throw incomplete();
    seen.add(next); continuation = next;
  }
  throw new EventbriteBookingImportError("Eventbrite liefert zu viele Ergebnisseiten. Es wurde nichts importiert.");
}

export function bookingImportErrorMessage(error: unknown): string {
  if (error instanceof EventbriteBookingImportError || error instanceof MemberAccessError) return error.message;
  if (error instanceof EventbriteError) return "Die Eventbrite-Verbindung kann nicht verwendet werden. Bitte die Company-Einstellungen prüfen.";
  if (error instanceof z.ZodError) return "Eventbrite hat unerwartete Daten geliefert. Es wurde nichts importiert. Bitte einen Plattformadministrator kontaktieren.";
  if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2002"].includes(error.code)) return "Buchungen wurden gleichzeitig geändert. Es wurde nichts importiert. Bitte erneut versuchen.";
  return "Der Import konnte nicht gespeichert werden. Es wurde nichts importiert. Bitte lokale Zahlungs-, Ticket- oder Stornierungsvorgänge prüfen.";
}

export async function importEventbriteBookings(slug: string, eventId: string) {
  const { company } = await requireBookingEvent(slug, eventId);
  const db = getPrisma();
  const mappings = await db.platformEvent.findMany({ where: { eventId, platform: "EVENTBRITE", event: { companyId: company.id } } });
  if (mappings.length !== 1) throw new EventbriteBookingImportError("Für dieses Event muss genau eine Eventbrite-Zuordnung vorhanden sein.");
  const mapping = mappings[0];
  if (!id.safeParse(mapping.externalEventId).success) throw new EventbriteBookingImportError("Die gespeicherte Eventbrite-ID ist ungültig.");
  const lease = randomUUID();
  const claimed = await db.platformEvent.updateMany({ where: { id: mapping.id, eventId, platform: "EVENTBRITE",
    event: { companyId: company.id },
    OR: [{ bookingImportToken: null }, { bookingImportStartedAt: { lt: new Date(Date.now() - 5 * 60_000) } }],
  }, data: { bookingImportToken: lease, bookingImportStartedAt: new Date(), lastBookingImportError: null } });
  if (claimed.count !== 1) throw new EventbriteBookingImportError("Für dieses Event läuft bereits ein Import. Bitte später erneut versuchen.");
  try {
    const connection = await db.eventbriteConnection.findUnique({ where: { companyId: company.id } });
    if (!connection || connection.status !== "CONNECTED") throw new EventbriteBookingImportError("Bitte zuerst eine gültige Eventbrite-Verbindung in den Company-Einstellungen herstellen.");
    const token = decrypt(connection.encryptedAccessToken, company.id);
    const path = `events/${encodeURIComponent(mapping.externalEventId)}/`;
    const deadline = Date.now() + 60_000;
    const remote = z.object({ id, organization_id: id }).parse(await request(token, path, deadline));
    if (remote.id !== mapping.externalEventId || remote.organization_id !== connection.organizationId) throw new EventbriteBookingImportError("Das Eventbrite-Event gehört nicht zur aktuell verbundenen Organisation.");
    const [orders, attendees] = await Promise.all([
      readPages<Order>(token, `${path}orders/`, "orders", orderSchema, deadline),
      readPages<Attendee>(token, `${path}attendees/`, "attendees", attendeeSchema, deadline),
    ]);
    const snapshot = normalizeEventbriteBookings(mapping.externalEventId, orders, attendees);
    // Recheck permissions after network requests, before any booking is written.
    await requireBookingEvent(slug, eventId);
    return await db.$transaction(async tx => {
      const current = await tx.eventbriteConnection.findUnique({ where: { companyId: company.id } });
      if (!current || current.status !== "CONNECTED" || current.organizationId !== connection.organizationId || current.updatedAt.getTime() !== connection.updatedAt.getTime()) throw new EventbriteBookingImportError("Die Eventbrite-Verbindung wurde während des Imports geändert. Bitte erneut versuchen.");
      const owned = await tx.platformEvent.updateMany({ where: {
        id: mapping.id, eventId, externalEventId: mapping.externalEventId, bookingImportToken: lease,
        event: { companyId: company.id },
      }, data: { bookingImportToken: lease } });
      if (owned.count !== 1) throw new EventbriteBookingImportError("Der Import wurde durch einen anderen Vorgang ersetzt. Bitte erneut versuchen.");
      const previous = await tx.booking.findMany({ where: { eventId, platform: "EVENTBRITE" }, select: {
        externalBookingId: true, quantity: true, status: true, customerName: true, customerEmail: true, bookedAt: true,
      } });
      const existing = new Map(previous.map(row => [row.externalBookingId, row]));
      if (snapshot.pendingOrderIds.some(orderId => existing.has(orderId))) throw new EventbriteBookingImportError("Eine bereits importierte Bestellung hat jetzt einen offenen Zahlungsstatus. Bitte den Stand in Eventbrite prüfen; es wurde nichts importiert.");
      const inputs = [...snapshot.bookings];
      let skipped = snapshot.skipped;
      // A provider tombstone can cancel a known order without inventing its quantity.
      for (const cancelled of snapshot.cancelledWithoutTickets) {
        const before = existing.get(cancelled.externalBookingId);
        if (before) inputs.push({ ...cancelled, quantity: before.quantity });
        else skipped++;
      }
      let created = 0, updated = 0, unchanged = 0;
      for (const input of inputs) {
        const before = existing.get(input.externalBookingId);
        await upsertExternalBookingInTransaction(tx, { ...input, eventId }, { notifyCompany: false, requireNoTickets: true });
        if (!before) created++;
        else if (before.quantity !== input.quantity || before.status !== input.status || before.customerName !== input.customerName || before.customerEmail !== input.customerEmail || before.bookedAt.getTime() !== input.bookedAt.getTime()) updated++;
        else unchanged++;
      }
      const importedAt = new Date();
      await tx.platformEvent.update({ where: { id: mapping.id }, data: {
        lastBookingImportAt: importedAt, lastBookingImportError: null, bookingImportToken: null,
      } });
      return { created, updated, unchanged, skipped, importedAt: importedAt.toISOString() };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
  } catch (error) {
    const message = bookingImportErrorMessage(error);
    // Never clear another import's claim, and never persist raw provider/DB errors.
    await db.platformEvent.updateMany({ where: { id: mapping.id, bookingImportToken: lease }, data: {
      lastBookingImportError: message, bookingImportToken: null,
    } }).catch(() => { /* A failed process/DB recovers through the five minute lease. */ });
    throw new EventbriteBookingImportError(message);
  }
}
