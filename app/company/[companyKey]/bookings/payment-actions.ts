"use server";

import { revalidatePath } from "next/cache";
import { MemberAccessError, requireCompanyAccess } from "@/lib/companies/members";
import { getPrisma } from "@/lib/db/prisma";
import { ensureCheckout } from "@/lib/payments/checkout";
import { applyCheckoutSession } from "@/lib/payments/fulfillment";
import { deliverPaymentMail } from "@/lib/payments/mail";

export async function checkBookingPayment(slug: string, bookingId: string): Promise<{ message: string; error?: boolean }> {
  try {
    const { company } = await requireCompanyAccess(slug);
    if (typeof bookingId !== "string" || !bookingId.trim() || bookingId.length > 191) {
      return { error: true, message: "Die Buchung wurde nicht gefunden." };
    }
    const db = getPrisma();
    const booking = await db.booking.findFirst({
      where: { id: bookingId, event: { companyId: company.id } },
      select: { eventId: true, payment: true },
    });
    if (!booking?.payment) return { error: true, message: "Die Buchung wurde nicht gefunden oder hat keine Stripe-Zahlung." };
    const payment = booking.payment;
    if (payment.status === "PENDING") {
      if (!payment.checkoutSessionId) return { error: true, message: "Für diese Zahlung ist keine Checkout-Sitzung hinterlegt. Bitte wende dich an den Support." };
      const session = await ensureCheckout(payment, { existingOnly: true });
      // Bind Stripe metadata to the authorized record before fulfillment selects by metadata.
      if (session.metadata?.paymentId !== payment.id || session.client_reference_id !== bookingId || session.id !== payment.checkoutSessionId) {
        throw new Error("Checkout association mismatch");
      }
      await applyCheckoutSession(session, payment.stripeAccountId);
    }
    // A webhook may have completed fulfillment during the Stripe request.
    const current = await db.payment.findUniqueOrThrow({ where: { id: payment.id }, select: { status: true } });
    if (current.status === "PAID") {
      try { await deliverPaymentMail(payment.id); } catch { /* Durable outbox retries delivery. */ }
    }
    const base = `/company/${encodeURIComponent(company.slug)}`;
    revalidatePath(`${base}/bookings`);
    revalidatePath(`${base}/events`);
    revalidatePath(`${base}/events/${encodeURIComponent(booking.eventId)}`);
    revalidatePath(`${base}/events/${encodeURIComponent(booking.eventId)}/bookings`);
    revalidatePath(`/events/${encodeURIComponent(company.slug)}/${encodeURIComponent(booking.eventId)}`);
    revalidatePath("/admin/events");
    return { message: current.status === "PAID"
      ? "Die Zahlung ist bestätigt. Die Buchung ist bezahlt und bestätigt."
      : current.status === "PENDING"
        ? "Stripe hat noch keine abgeschlossene Zahlung bestätigt."
        : current.status === "EXPIRED"
          ? "Stripe hat die Checkout-Sitzung als abgelaufen bestätigt."
          : "Die Zahlung ist nicht mehr ausstehend. Der aktuelle Status wird angezeigt." };
  } catch (error) {
    return { error: true, message: error instanceof MemberAccessError ? error.message : "Die Zahlung konnte gerade nicht geprüft werden. Bitte versuche es später erneut." };
  }
}
