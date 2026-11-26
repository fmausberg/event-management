import "server-only";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/lib/db/prisma";
import { decrypt } from "./connection";
import { plainTextToDescription, sanitizeDescription } from "@/lib/descriptions/html";
import { escapeHtml } from "@/lib/mail/templates/footer";

const idSchema = z.object({ id: z.string().regex(/^\d+$/) });
class PublicationError extends Error {
  constructor(message: string, public uncertain = false) { super(message); }
}

// Lazy, server-only runtime setting: no build-time evaluation or client exposure.
function listedForNewEvents() {
  const parsed = z.enum(["true", "false"]).safeParse(process.env.EVENTBRITE_LISTED ?? "true");
  if (!parsed.success) throw new PublicationError("EVENTBRITE_LISTED ist ungültig. Erlaubt sind ausschließlich true und false. Bitte die serverseitige Umgebungsvariable korrigieren.");
  return parsed.data === "true";
}

// Never expose provider bodies: these may contain submitted data or credentials.
async function api(token: string, path: string, body?: unknown, ambiguousOnFailure = false): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`https://www.eventbriteapi.com/v3/${path}`, {
      method: body === undefined ? "GET" : "POST", cache: "no-store", redirect: "error",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
    });
  } catch { throw new PublicationError("Eventbrite ist nicht erreichbar. Bitte den Übertragungsstatus prüfen.", ambiguousOnFailure); }
  if (!response.ok) {
    const message = response.status === 401 || response.status === 403
      ? "Eventbrite-Zugriff fehlt. Bitte die Verbindung und Verwaltungsrechte prüfen."
      : response.status === 400 ? "Eventbrite hat die Angaben abgelehnt. Bitte Ort, Veranstalter, Ticketpreis sowie Zahlungs- und Steuereinstellungen in Eventbrite prüfen."
      : "Eventbrite konnte den Auftrag nicht abschließen. Bitte später erneut versuchen.";
    throw new PublicationError(message, ambiguousOnFailure && (response.status >= 500 || response.status === 408));
  }
  try { return await response.json(); }
  catch { throw new PublicationError("Eventbrite hat keine auswertbare Antwort geliefert.", ambiguousOnFailure); }
}

export function ticketPriceInCents(price: string): number {
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(price)) throw new PublicationError("Der Ticketpreis ist ungültig.");
  const [units, fraction = ""] = price.split(".");
  return Number(units) * 100 + Number(fraction.padEnd(2, "0"));
}

/** Enqueue inside the publication transaction, before any notification early return. */
export async function queueEventbritePublication(tx: Prisma.TransactionClient, eventId: string) {
  const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { companyId: true, postToEventbrite: true } });
  if (!event.postToEventbrite) return;
  const connection = await tx.eventbriteConnection.findUnique({ where: { companyId: event.companyId }, select: { organizationId: true } });
  const mapping = await tx.platformEvent.findFirst({ where: { eventId, platform: "EVENTBRITE" }, select: { externalEventId: true } });
  // An existing job keeps its original organization even if the connection changes.
  await tx.eventbritePublication.upsert({ where: { eventId }, update: {}, create: {
    eventId, organizationId: connection?.organizationId ?? "", externalEventId: mapping?.externalEventId,
    status: mapping ? "UNCERTAIN" : connection ? "PENDING" : "ERROR",
    lastError: mapping ? "Es gibt bereits eine Eventbrite-Zuordnung. Bitte vor der Übertragung durch einen Plattformadministrator abgleichen lassen." : connection ? null : "Keine Eventbrite-Organisation verbunden.",
  } });
}

/** Atomic claims serialize workers. An interrupted create is never blindly repeated. */
export async function deliverEventbritePublications(companyId?: string) {
  const db = getPrisma();
  await db.eventbritePublication.updateMany({ where: {
    status: { in: ["PROCESSING", "UNCERTAIN"] }, attemptedAt: { lt: new Date(Date.now() - 10 * 60_000) },
    ...(companyId ? { event: { companyId } } : {}),
  }, data: { status: "UNCERTAIN", lastError: "Übertragung unterbrochen. Vor einem weiteren Versuch bitte den Stand in Eventbrite abgleichen, um Duplikate zu vermeiden." } });
  const jobs = await db.eventbritePublication.findMany({ where: {
    status: "PENDING", event: { status: "PUBLISHED", postToEventbrite: true, ...(companyId ? { companyId } : {}) },
  }, orderBy: { createdAt: "asc" }, take: 5 });
  let failures = 0;
  for (const job of jobs) {
    const claimed = await db.eventbritePublication.updateMany({ where: { eventId: job.eventId, status: "PENDING" },
      data: { status: "PROCESSING", attemptedAt: new Date(), lastError: null } });
    if (!claimed.count) continue;
    try {
      const event = await db.event.findUniqueOrThrow({ where: { id: job.eventId }, include: { venue: true, company: true } });
      const connection = await db.eventbriteConnection.findUnique({ where: { companyId: event.companyId } });
      if (!event.postToEventbrite || event.status !== "PUBLISHED") throw new PublicationError("Das Event ist aktuell nicht zur Veröffentlichung freigegeben.");
      if (!connection || connection.status !== "CONNECTED" || connection.organizationId !== job.organizationId) throw new PublicationError("Die ursprünglich gewählte Eventbrite-Organisation ist nicht mehr verbunden.");
      if (!event.beginsAt || !event.endsAt || event.beginsAt <= new Date() || !event.venue || event.maxSeats === null || event.maxSeats < 1 || event.ticketPrice === null) throw new PublicationError("Eventbrite benötigt einen zukünftigen Beginn, einen Ort, einen Preis und mindestens einen Platz.");
      const cents = ticketPriceInCents(event.ticketPrice.toFixed(2));
      if (event.currency !== "EUR") throw new PublicationError("Die Eventbrite-Veröffentlichung unterstützt derzeit EUR.");
      const token = decrypt(connection.encryptedAccessToken, event.companyId);
      const org = encodeURIComponent(job.organizationId);
      const utc = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, "Z");
      // Recover a completed publication before reading draft-only configuration
      // or creating/updating any remote resource, including a missing venue.
      const existingRemote = job.externalEventId
        ? z.object({ status: z.string() }).parse(await api(token, `events/${encodeURIComponent(job.externalEventId)}/`))
        : null;
      if (existingRemote?.status === "live" || existingRemote?.status === "started") {
        await db.eventbritePublication.update({ where: { eventId: job.eventId }, data: { status: "PUBLISHED", lastError: null } });
        continue;
      }
      if (existingRemote && existingRemote.status !== "draft") throw new PublicationError("Das Event wurde bei Eventbrite geändert und wird nicht erneut veröffentlicht.");
      // Validate before the first create; invalid configuration must not create a venue.
      const listed = listedForNewEvents();

      // Persist uncertainty BEFORE each non-idempotent create. The response ID and
      // local mapping commit together; a DB/network failure cannot cause a retry.
      async function createRemote(path: string, body: unknown, field: "venueId" | "externalEventId" | "ticketClassId") {
        await db.eventbritePublication.update({ where: { eventId: job.eventId }, data: { status: "UNCERTAIN" } });
        const raw = await api(token, path, body, true);
        const parsed = idSchema.safeParse(raw);
        if (!parsed.success) throw new PublicationError("Die Eventbrite-ID konnte nicht gespeichert werden. Bitte den Stand bei Eventbrite prüfen.", true);
        await db.$transaction(async tx => {
          await tx.eventbritePublication.update({ where: { eventId: job.eventId }, data: { [field]: parsed.data.id, status: "PROCESSING" } });
          if (field === "externalEventId") await tx.platformEvent.create({ data: {
            eventId: job.eventId, platform: "EVENTBRITE", externalEventId: parsed.data.id, syncStatus: "DISABLED",
          } });
        });
        return parsed.data.id;
      }

      const venueData = { venue: {
        name: event.venue.name, address: {
          address_1: event.venue.addressLine1 ?? "", address_2: event.venue.addressLine2 ?? "",
          city: event.venue.city ?? "", postal_code: event.venue.postalCode ?? "", country: event.venue.countryCode ?? "",
        },
      } };
      const venueId = job.venueId ?? await createRemote(`organizations/${org}/venues/`, venueData, "venueId");
      const eventData = { event: {
        name: { html: escapeHtml(event.name) }, summary: (event.shortdescription ?? event.name).slice(0, 140),
        start: { timezone: "Europe/Berlin", utc: utc(event.beginsAt) }, end: { timezone: "Europe/Berlin", utc: utc(event.endsAt) },
        currency: event.currency, venue_id: venueId, listed, online_event: false, capacity: event.maxSeats, locale: "de_DE",
      } };
      const externalId = job.externalEventId ?? await createRemote(`organizations/${org}/events/`, eventData, "externalEventId");
      const path = `events/${encodeURIComponent(externalId)}/`;
      const remote = existingRemote ?? z.object({ status: z.string() }).parse(await api(token, path));
      if (remote.status !== "live" && remote.status !== "started") {
        if (remote.status !== "draft") throw new PublicationError("Das Event wurde bei Eventbrite geändert und wird nicht erneut veröffentlicht.");
        // A failed attempt may be retried after editing the local draft data.
        // Update existing resources rather than creating another event or venue.
        if (job.venueId) await api(token, `venues/${encodeURIComponent(venueId)}/`, venueData);
        if (job.externalEventId) await api(token, path, eventData);
        const content = z.object({ page_version_number: z.string().regex(/^\d+$/) }).parse(await api(token, `${path}structured_content/edit/`));
        await api(token, `${path}structured_content/${Number(content.page_version_number) + 1}/`, {
          publish: true, modules: [{ type: "text", data: { body: { alignment: "left",
            text: sanitizeDescription(event.description) ?? plainTextToDescription(event.shortdescription ?? event.name),
          } } }],
        });
        const ticketData = { ticket_class: {
          name: "Teilnahme", capacity: event.maxSeats, free: cents === 0,
          ...(cents === 0 ? {} : { cost: `${event.currency},${cents}`, include_fee: true }),
          sales_end: utc(event.beginsAt), minimum_quantity: 1, maximum_quantity: Math.min(10, event.maxSeats),
        } };
        const ticketId = job.ticketClassId ?? await createRemote(`${path}ticket_classes/`, ticketData, "ticketClassId");
        if (job.ticketClassId) await api(token, `${path}ticket_classes/${encodeURIComponent(ticketId)}/`, ticketData);
        const ticket = await api(token, `${path}ticket_classes/${encodeURIComponent(ticketId)}/`);
        assertTicketPrice(ticket, cents, event.currency);
        // Recheck immediately before enabling sales, including connection replacement.
        const current = await db.event.findUniqueOrThrow({ where: { id: event.id } });
        const currentConnection = await db.eventbriteConnection.findUnique({ where: { companyId: event.companyId } });
        if (current.status !== "PUBLISHED" || !current.postToEventbrite || current.updatedAt.getTime() !== event.updatedAt.getTime() || currentConnection?.updatedAt.getTime() !== connection.updatedAt.getTime()) throw new PublicationError("Event oder Verbindung wurden während der Übertragung geändert. Bitte Angaben prüfen.");
        const result = z.object({ published: z.boolean() }).parse(await api(token, `${path}publish/`, {}));
        if (!result.published) throw new PublicationError("Eventbrite hat die Veröffentlichung nicht bestätigt.");
      }
      await db.eventbritePublication.update({ where: { eventId: job.eventId }, data: { status: "PUBLISHED", lastError: null } });
    } catch (error) {
      failures++;
      const current = await db.eventbritePublication.findUniqueOrThrow({ where: { eventId: job.eventId } });
      // Unknown errors after a create may mean the response ID failed to commit.
      const uncertain = error instanceof PublicationError ? error.uncertain : current.status === "UNCERTAIN";
      await db.eventbritePublication.update({ where: { eventId: job.eventId }, data: {
        status: uncertain ? "UNCERTAIN" : "ERROR",
        lastError: error instanceof PublicationError ? error.message : "Die Übertragung konnte nicht abgeschlossen werden. Bitte den Eventbrite-Stand prüfen.",
      } });
    }
  }
  return { checked: jobs.length, failures };
}

/** Displayed price must match; never silently launch sales with extra tax/fees. */
export function assertTicketPrice(raw: unknown, cents: number, currency: string) {
  const money = z.object({ currency: z.string(), value: z.number().int() });
  const parsed = z.object({ free: z.boolean(), include_fee: z.boolean().nullish(),
    cost: z.union([money, z.object({ cost: money, fee: money, tax: money })]).nullish(),
    tax: money.nullish(),
  }).safeParse(raw);
  if (!parsed.success) throw new PublicationError("Eventbrite liefert keinen prüfbaren Ticketpreis. Das Event bleibt dort als Entwurf erhalten.");
  const ticket = parsed.data;
  if (cents === 0 && ticket.free) return;
  const display = ticket.cost && ("cost" in ticket.cost ? ticket.cost.cost : ticket.cost);
  const tax = ticket.cost && "tax" in ticket.cost ? ticket.cost.tax : ticket.tax;
  if (!ticket.free && ticket.include_fee && display?.currency === currency && display.value === cents && tax?.value === 0) return;
  throw new PublicationError("Der Eventbrite-Preis entspricht nicht dem prüfbaren Bruttopreis. Bitte Gebührenübernahme aktivieren und zusätzliche Steueraufschläge in Eventbrite prüfen; anschließend erneut versuchen.");
}
