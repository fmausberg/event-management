"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getGuestBooking, type GuestBooking } from "@/lib/bookings/guest-management";
import { CancellationError, requestCancellationWithToken } from "@/lib/cancellations/service";
import { processCancellationRefund } from "@/lib/cancellations/refunds";
import { deliverCancellationMails } from "@/lib/cancellations/mail";

export type GuestBookingState = { success?: boolean; message?: string; booking?: GuestBooking };
const tokenSchema = z.string().min(1).max(1500);

export async function loadGuestBooking(token: string): Promise<GuestBookingState> {
  if (!tokenSchema.safeParse(token).success) return { message: "Der Verwaltungslink ist ungültig oder nicht mehr verfügbar." };
  try {
    const booking = await getGuestBooking(token);
    return booking ? { booking } : { message: "Der Verwaltungslink ist ungültig oder nicht mehr verfügbar." };
  } catch {
    return { message: "Die Buchung kann gerade nicht geladen werden. Bitte versuche es später erneut." };
  }
}

export async function cancelGuestBooking(token: string, _previous: GuestBookingState, form: FormData): Promise<GuestBookingState> {
  let request;
  try {
    tokenSchema.parse(token);
    const intent = z.enum(["free", "request"]).parse(form.get("intent"));
    const note = z.string().max(2000).parse(form.get("note") ?? "");
    if (form.get("confirmed") !== "yes") return { message: "Bitte bestätige die Stornierung der gesamten Buchung." };
    request = await requestCancellationWithToken(token, note, intent);
  } catch (error) {
    const current = await loadGuestBooking(token);
    return { booking: current.booking, message: error instanceof CancellationError ? error.message
      : error instanceof z.ZodError ? "Bitte prüfe deine Eingaben."
      : "Der Vorgang konnte nicht abgeschlossen werden. Bitte prüfe den aktuellen Buchungsstatus, bevor du es erneut versuchst." };
  }
  // The request is committed. Failures below must not invite a duplicate cancellation.
  let deliveryPending = false;
  if (request.status === "APPROVED" && request.refundStatus !== "NONE") {
    try { await processCancellationRefund(request.id); } catch { /* Existing reconciliation retries pending refunds. */ }
  }
  try { deliveryPending = (await deliverCancellationMails()) > 0; } catch { deliveryPending = true; }
  revalidatePath("/account/bookings");
  revalidatePath("/company/[companyKey]", "layout");
  revalidatePath("/events/[companySlug]/[eventId]", "page");
  const current = await loadGuestBooking(token);
  return { success: true, booking: current.booking, message: (request.status === "APPROVED"
    ? "Die gesamte Buchung und alle Tickets sind storniert. Eine mögliche Erstattung wird separat bearbeitet."
    : "Deine Stornierungsanfrage wurde gespeichert. Bis zur Genehmigung bleiben alle Tickets gültig.")
    + (deliveryPending ? " Eine Benachrichtigung ist noch zum Versand vorgemerkt." : "") };
}
