import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
type Payload = { id: string; eventId: string; price: string; currency: string; expires: number };
function signature(value: string) {
 const secret = process.env.AUTH_SECRET;
 if (!secret) throw new Error("AUTH_SECRET is required");
 return createHmac("sha256", secret).update(`public-booking:${value}`).digest("base64url");
}
export function createBookingToken(eventId: string, price: string, currency: string) {
 const value = Buffer.from(JSON.stringify({ id: randomUUID(), eventId, price, currency, expires: Date.now() + 60 * 60 * 1000 })).toString("base64url");
 return `${value}.${signature(value)}`;
}
export function readBookingToken(token: unknown): Payload | null {
 if (typeof token !== "string" || token.length > 2000) return null;
 try {
  const [value, sig, extra] = token.split(".");
  if (!value || !sig || extra) return null;
  const expected = Buffer.from(signature(value)); const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  const payload = JSON.parse(Buffer.from(value, "base64url").toString()) as Payload;
  if (typeof payload.id !== "string" || typeof payload.eventId !== "string" || typeof payload.price !== "string" || typeof payload.currency !== "string" || !Number.isFinite(payload.expires) || payload.expires < Date.now()) return null;
  return payload;
 } catch { return null; }
}

export function createBookingConfirmationToken(bookingId: string) {
 return `${bookingId}.${signature(`confirmation:${bookingId}`)}`;
}

export function readBookingConfirmationToken(token: string): string | null {
 const match = /^([a-f0-9-]{36})\.([A-Za-z0-9_-]{43})$/.exec(token);
 if (!match) return null;
 const expected = Buffer.from(signature(`confirmation:${match[1]}`));
 return timingSafeEqual(expected, Buffer.from(match[2])) ? match[1] : null;
}
