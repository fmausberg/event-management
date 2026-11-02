import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const payloadSchema = z.object({ bookingId: z.string().min(1).max(191), recipient: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
type BookingContact = { id: string; customerEmail: string | null };

function digest(scope: string, value: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required");
  return createHmac("sha256", secret).update(`booking-management:v1:${scope}:${value}`).digest("base64url");
}

/** Separate capability from ticket/checkout tokens; changing the booking email revokes old links. */
export function createBookingManagementToken(booking: BookingContact) {
  if (!booking.customerEmail) throw new Error("Missing booking contact");
  const payload = payloadSchema.parse({ bookingId: booking.id, recipient: digest("recipient", booking.customerEmail.trim().toLowerCase()) });
  const value = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${value}.${digest("signature", value)}`;
}

export function readBookingManagementToken(token: unknown) {
  if (typeof token !== "string" || token.length > 1500) return null;
  const match = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return null;
  try {
    const [, value, signature] = match;
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(digest("signature", value)))) return null;
    return payloadSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
  } catch { return null; }
}

export function managementTokenMatchesBooking(payload: NonNullable<ReturnType<typeof readBookingManagementToken>>, booking: BookingContact) {
  if (payload.bookingId !== booking.id || !booking.customerEmail) return false;
  return timingSafeEqual(Buffer.from(payload.recipient), Buffer.from(digest("recipient", booking.customerEmail.trim().toLowerCase())));
}

export function bookingManagementLink(booking: BookingContact) {
  const base = new URL(process.env.AUTH_URL ?? "http://localhost:3000");
  if (base.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && base.protocol === "http:" && base.hostname === "localhost")) {
    throw new Error("AUTH_URL must use HTTPS for booking management");
  }
  // The capability stays out of access logs and Referer headers.
  return new URL(`/booking/manage#${createBookingManagementToken(booking)}`, base.origin).toString();
}
