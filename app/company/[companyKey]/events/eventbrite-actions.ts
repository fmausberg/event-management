"use server";
import { revalidatePath } from "next/cache";
import { requireCompanyAccess } from "@/lib/companies/members";
import { withSessionAudit } from "@/lib/audit/session";
import { getPrisma } from "@/lib/db/prisma";
import { deliverEventbritePublications } from "@/lib/eventbrite/publication";
import { bookingImportErrorMessage, importEventbriteBookings } from "@/lib/eventbrite/booking-import";
import type { EventbriteBookingImportState } from "@/lib/eventbrite/booking-import-state";

export async function syncEventbriteBookings(slug: string, eventId: string, _previous: EventbriteBookingImportState): Promise<EventbriteBookingImportState> {
  return withSessionAudit("company.events.importEventbriteBookings", async () => {
    let state: EventbriteBookingImportState;
    try {
      const result = await importEventbriteBookings(slug, eventId);
      state = { success: true, message: `${result.created} Buchungen neu, ${result.updated} aktualisiert, ${result.unchanged} unverändert.${result.skipped ? ` ${result.skipped} offene oder nicht vollständig rekonstruierbare stornierte Bestellungen übersprungen.` : ""}` };
    } catch (error) { state = { success: false, message: bookingImportErrorMessage(error) }; }
    revalidatePath(`/company/${encodeURIComponent(slug)}/events/${encodeURIComponent(eventId)}`);
    revalidatePath(`/company/${encodeURIComponent(slug)}/events/${encodeURIComponent(eventId)}/bookings`);
    revalidatePath(`/company/${encodeURIComponent(slug)}/events`);
    revalidatePath(`/company/${encodeURIComponent(slug)}/bookings`);
    revalidatePath(`/company/${encodeURIComponent(slug)}/event-series`, "layout");
    revalidatePath(`/events/${encodeURIComponent(slug)}/${encodeURIComponent(eventId)}`);
    revalidatePath(`/events/${encodeURIComponent(slug)}`);
    revalidatePath("/events");
    revalidatePath("/admin/events");
    return state;
  });
}

export async function retryEventbritePublication(slug: string, eventId: string) {
  return withSessionAudit("company.events.retryEventbritePublication", async () => {
    const { company } = await requireCompanyAccess(slug);
    const db = getPrisma();
    const connection = await db.eventbriteConnection.findUnique({ where: { companyId: company.id }, select: { organizationId: true, status: true } });
    // If the connection vanished before enqueueing there was no remote operation
    // or organization binding. An explicit retry can establish that first binding.
    if (connection?.status === "CONNECTED") await db.eventbritePublication.updateMany({ where: {
      eventId, organizationId: "", externalEventId: null, venueId: null, ticketClassId: null, status: "ERROR",
      event: { companyId: company.id, status: "PUBLISHED", postToEventbrite: true },
    }, data: { organizationId: connection.organizationId } });
    // Never reset uncertain work: it may already exist remotely without a saved ID.
    await db.eventbritePublication.updateMany({ where: {
      eventId, status: "ERROR", event: { companyId: company.id, status: "PUBLISHED", postToEventbrite: true },
    }, data: { status: "PENDING", lastError: null } });
    await deliverEventbritePublications(company.id);
    revalidatePath(`/company/${encodeURIComponent(slug)}/events/${encodeURIComponent(eventId)}`);
  });
}
