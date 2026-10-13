import { createHash } from "node:crypto";
import { getPrisma } from "@/lib/db/prisma";

export const runtime = "nodejs";
const responseHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };
function reply(body: object, status = 200) {
  return Response.json(body, { status, headers: responseHeaders });
}

export async function POST(request: Request) {
  try {
    const db = getPrisma();
    const now = Date.now();
    // Shared database-backed ceiling, independent of spoofable proxy/IP headers.
    const key = `public-ticket:${Math.floor(now / 60000)}`;
    await db.authRateLimit.deleteMany({ where: { expiresAt: { lte: new Date(now) } } });
    const limit = await db.authRateLimit.upsert({ where: { key }, create: { key, attempts: 1, expiresAt: new Date((Math.floor(now / 60000) + 1) * 60000) }, update: { attempts: { increment: 1 } } });
    if (limit.attempts > 300) {
      const response = reply({ message: "Zu viele Anfragen. Bitte in einer Minute erneut versuchen." }, 429);
      response.headers.set("Retry-After", "60");
      return response;
    }
    // Read a bounded body, including when Content-Length is absent or untrusted.
    const reader = request.body?.getReader();
    if (!reader) return reply({ message: "Ticket nicht verfügbar." }, 404);
    let body = "";
    const decoder = new TextDecoder();
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 256) { await reader.cancel(); return reply({ message: "Ticket nicht verfügbar." }, 404); }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    if (!/^[A-Za-z0-9_-]{43}$/.test(body)) return reply({ message: "Ticket nicht verfügbar." }, 404);
    const ticket = await db.ticket.findUnique({
      where: { publicTokenHash: createHash("sha256").update(body).digest("hex") },
      select: { number: true, status: true, checkedInAt: true, booking: { select: { status: true, event: { select: { name: true, beginsAt: true, status: true, venue: { select: { name: true, city: true } } } } } } },
    });
    if (!ticket) return reply({ message: "Ticket nicht verfügbar." }, 404);
    const event = ticket.booking.event;
    const status = ticket.status === "CANCELLED" || ticket.booking.status === "CANCELLED" || event.status === "CANCELLED" ? "Storniert" : ticket.checkedInAt ? "Bereits eingelöst" : "Gültig";
    return reply({ number: ticket.number, status, eventName: event.name, beginsAt: event.beginsAt.toISOString(), venue: event.venue ? [event.venue.name, event.venue.city].filter(Boolean).join(", ") : null });
  } catch {
    return reply({ message: "Ticket aktuell nicht verfügbar. Bitte später erneut versuchen." }, 503);
  }
}
