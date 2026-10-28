import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { renderToStaticMarkup } from "react-dom/server";
import { bookPublicEvent } from "@/app/(public)/events/[companySlug]/[eventId]/actions";
import Page from "@/app/(public)/events/[companySlug]/[eventId]/page";
import { createBookingToken, readBookingToken } from "@/lib/bookings/public-token";
import * as ticketTokens from "@/lib/tickets/public-token";
import { revalidatePath } from "next/cache";
import { sendMail } from "@/lib/mail";
import { refreshConnectAccount } from "@/lib/payments/connect";
import { ensureCheckout } from "@/lib/payments/checkout";
vi.mock("@/lib/payments/connect", () => ({ refreshConnectAccount: vi.fn() }));
vi.mock("@/lib/payments/checkout", () => ({ ensureCheckout: vi.fn() }));
vi.mock("@/lib/mail", () => ({ sendMail: vi.fn() }));
const { auth, db, rate } = vi.hoisted(() => ({ auth: vi.fn(), rate: vi.fn(), db: { event: { findFirst: vi.fn() }, booking: { findUnique: vi.fn(), aggregate: vi.fn(), create: vi.fn() }, payment: { findUniqueOrThrow: vi.fn() }, ticket: { createMany: vi.fn() }, $transaction: vi.fn() } }));
vi.mock("@/auth", () => ({ auth }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("@/lib/auth/rate-limit", () => ({ consumeAuthAttempt: rate }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
const event = { id: "event-1", name: "Yoga", shortdescription: "Yoga session", description: "Bring a mat.", trainerName: "Ada", status: "PUBLISHED", beginsAt: new Date("2099-10-16T08:00:00Z"), endsAt: new Date("2099-10-16T09:00:00Z"), maxSeats: 10, ticketPrice: { toFixed: () => "0.00" }, currency: "EUR", company: { slug: "yoga", name: "Studio" }, venue: null, eventSeries: null };
function form(token = createBookingToken("event-1", "0.00", "EUR"), overrides: Record<string, string> = {}) {
 const data = new FormData(); Object.entries({ token, name: " Ada ", email: " ADA@example.com ", quantity: "2", ...overrides }).forEach(([k, v]) => data.set(k, v)); return data;
}
beforeEach(() => {
  vi.stubEnv("TICKET_CODE_ENCRYPTION_KEYS", JSON.stringify({ active: "k1", keys: { k1: Buffer.alloc(32, 7).toString("base64") } }));

 vi.stubEnv("AUTH_URL", "https://events.example.com");
 vi.resetAllMocks(); auth.mockResolvedValue(null); vi.stubEnv("AUTH_SECRET", "test-only-booking-secret");
 rate.mockResolvedValue(true); db.event.findFirst.mockResolvedValue(event); db.booking.findUnique.mockResolvedValue(null);
 db.booking.aggregate.mockResolvedValue({ _sum: { quantity: 3 } }); db.booking.create.mockResolvedValue({ number: 42 });
 db.$transaction.mockImplementation(async (callback) => callback(db));
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it("creates a guest booking with normalized contact details, trusted status and event", async () => {
 const token = createBookingToken("event-1", "0.00", "EUR");
 expect(await bookPublicEvent("yoga", "event-1", {}, form(token, { userId: "foreign", status: "CANCELLED", ticketPrice: "0" }))).toMatchObject({ success: true, number: 42 });
 expect(db.booking.create).toHaveBeenCalledWith({ data: { id: readBookingToken(token)!.id, eventId: "event-1", userId: null, customerName: "Ada", customerEmail: "ada@example.com", quantity: 2, status: "CONFIRMED", platform: null, externalBookingId: null }, select: { number: true } });
 expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
 expect(db.event.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "event-1", company: { slug: "yoga" } } }));
});
it("reserves paid tickets at the trusted price and redirects without issuing tickets or mail", async () => {
 const company = { stripeAccountId: "acct_studio", stripeChargesEnabled: true, stripePayoutsEnabled: true };
 db.event.findFirst.mockResolvedValue({ ...event, companyId: "company-1", company, ticketPrice: { toFixed: () => "12.50" } });
 vi.mocked(refreshConnectAccount).mockResolvedValue(company as Awaited<ReturnType<typeof refreshConnectAccount>>);
 db.payment.findUniqueOrThrow.mockResolvedValue({ id: "payment-1" });
 vi.mocked(ensureCheckout).mockResolvedValue({ status: "open", url: "https://checkout.stripe.com/test" } as Awaited<ReturnType<typeof ensureCheckout>>);
 await expect(bookPublicEvent("yoga", "event-1", {}, form(createBookingToken("event-1", "12.50", "EUR"), { ticketPrice: "0.01", stripeAccountId: "acct_attacker" }))).rejects.toThrow("REDIRECT:https://checkout.stripe.com/test");
 const data = db.booking.create.mock.calls[0][0].data;
 expect(data).toMatchObject({ status: "PENDING_PAYMENT", reservedUntil: expect.any(Date), quantity: 2, payment: { create: { amount: 2500, currency: "EUR", stripeAccountId: "acct_studio", checkoutRequest: { allowed_payment_method_types: ["card"], line_items: [{ price_data: { unit_amount: 1250 }, quantity: 2 }] } } } });
 expect(db.booking.aggregate).toHaveBeenCalledWith({ where: { eventId: "event-1", status: { in: ["CONFIRMED", "PENDING_PAYMENT"] } }, _sum: { quantity: true } });
 expect(db.ticket.createMany).not.toHaveBeenCalled();
 expect(sendMail).not.toHaveBeenCalled();
});
it("refuses paid bookings until the connected account can charge and pay out", async () => {
 db.event.findFirst.mockResolvedValue({ ...event, companyId: "company-1", ticketPrice: { toFixed: () => "12.50" } });
 vi.mocked(refreshConnectAccount).mockResolvedValue({ stripeAccountId: "acct_studio", stripeChargesEnabled: false, stripePayoutsEnabled: false } as Awaited<ReturnType<typeof refreshConnectAccount>>);
 expect((await bookPublicEvent("yoga", "event-1", {}, form(createBookingToken("event-1", "12.50", "EUR")))).message).toContain("nicht freigeschaltet");
 expect(db.booking.create).not.toHaveBeenCalled();
 expect(ensureCheckout).not.toHaveBeenCalled();
});
it("does not turn an expired or cancelled booking into a confirmation", async () => {
 db.booking.findUnique.mockResolvedValue({ eventId: "event-1", number: 42, status: "EXPIRED" });
 expect((await bookPublicEvent("yoga", "event-1", {}, form())).success).toBeUndefined();
 expect(db.ticket.createMany).not.toHaveBeenCalled();
});
it("associates public bookings with the authenticated user", async () => {
 auth.mockResolvedValue({ user: { id: "user-1" } });
 const token = createBookingToken("event-1", "0.00", "EUR");
 await bookPublicEvent("yoga", "event-1", {}, form(token));
 expect(db.booking.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: "user-1" }), select: { number: true } });
});
it("reuses an existing booking for repeated submission without inserting again", async () => {
 db.booking.findUnique.mockResolvedValue({ eventId: "event-1", number: 42, status: "CONFIRMED" });
 expect((await bookPublicEvent("yoga", "event-1", {}, form())).number).toBe(42);
 expect(db.booking.create).not.toHaveBeenCalled();
 expect(db.ticket.createMany).not.toHaveBeenCalled();
 expect(sendMail).not.toHaveBeenCalled();
});
it("sends confirmation to the normalized booking email only after commit", async () => {
 let committed = false;
 db.$transaction.mockImplementation(async (callback) => {
  const result = await callback(db);
  expect(sendMail).not.toHaveBeenCalled();
  committed = true;
  return result;
 });
 vi.mocked(sendMail).mockImplementation(async () => {
  expect(committed).toBe(true);
  return { messageId: "test" };
 });
 const data = form();
 await bookPublicEvent("yoga", "event-1", {}, data);
 expect(sendMail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ to: "ada@example.com", subject: "Deine Buchungsbestätigung #42", text: expect.stringContaining("Event: Yoga"), html: expect.stringContaining("Anzahl Plätze: 2") }));
 db.booking.findUnique.mockResolvedValue({ eventId: "event-1", number: 42, status: "CONFIRMED" });
 db.$transaction.mockImplementation(async (callback) => callback(db));
 await bookPublicEvent("yoga", "event-1", {}, data);
 expect(sendMail).toHaveBeenCalledTimes(1);
});
it("keeps the booking successful and shows a warning if SMTP fails", async () => {
 vi.mocked(sendMail).mockRejectedValue(new Error("SMTP failed"));
 const result = await bookPublicEvent("yoga", "event-1", {}, form());
 expect(result).toMatchObject({ success: true, number: 42 });
 expect(result.message).toContain("E-Mail konnte nicht versendet");
 expect(revalidatePath).toHaveBeenCalled();
});
it("sends no confirmation when committing the transaction fails", async () => {
 db.$transaction.mockImplementation(async (callback) => {
  await callback(db);
  throw new Error("commit failed");
 });
 expect((await bookPublicEvent("yoga", "event-1", {}, form())).success).toBeUndefined();
 expect(sendMail).not.toHaveBeenCalled();
});
it.each([1, 2, 7])("creates exactly %i valid tickets and persists their hashes and ciphertexts", async (quantity) => {
 const generated = vi.spyOn(ticketTokens, "createTicketToken");
 const token = createBookingToken("event-1", "0.00", "EUR");
 const result = await bookPublicEvent("yoga", "event-1", {}, form(token, { quantity: String(quantity) }));
 expect(result.success).toBe(true);
 expect(generated).toHaveBeenCalledTimes(quantity);
 expect(db.ticket.createMany).toHaveBeenCalledExactlyOnceWith({ data: generated.mock.results.map(({ value }) => ({
  bookingId: readBookingToken(token)!.id, status: "VALID", publicTokenHash: value.publicTokenHash, encryptedPublicToken: value.encryptedPublicToken,
 })) });
 expect(new Set(generated.mock.results.map(({ value }) => value.publicTokenHash)).size).toBe(quantity);
 const persisted = JSON.stringify([db.booking.create.mock.calls, db.ticket.createMany.mock.calls, result]);
 for (const { value } of generated.mock.results) expect(persisted).not.toContain(value.token);
 const mail = vi.mocked(sendMail).mock.calls[0][0];
 for (const { value } of generated.mock.results) {
  expect(mail.text).toContain(`https://events.example.com/tickets#${value.token}`);
  expect(mail.html).toContain(`href="https://events.example.com/tickets#${value.token}"`);
 }
});
it("does not add tickets when the same successful form is submitted again", async () => {
 const data = form();
 const first = await bookPublicEvent("yoga", "event-1", {}, data);
 db.booking.findUnique.mockResolvedValue({ eventId: "event-1", number: first.number, status: "CONFIRMED" });
 expect(await bookPublicEvent("yoga", "event-1", {}, data)).toEqual(first);
 expect(db.booking.create).toHaveBeenCalledTimes(1);
 expect(db.ticket.createMany).toHaveBeenCalledTimes(1);
});
it("does not issue tickets or send mail if ticket encryption is not configured", async () => {
 vi.stubEnv("TICKET_CODE_ENCRYPTION_KEYS", "");
 vi.spyOn(console, "error").mockImplementation(() => {});
 const result = await bookPublicEvent("yoga", "event-1", {}, form());
 expect(result.success).toBeUndefined();
 expect(db.ticket.createMany).not.toHaveBeenCalled();
 expect(sendMail).not.toHaveBeenCalled();
 expect(console.error).toHaveBeenCalledWith("[tickets:create] Code unavailable", "CONFIG");
});
it("propagates ticket failures out of the transaction and permits a clean retry", async () => {
 // This transaction double commits staged writes only if the callback resolves.
 // Separate clients also ensure both writes use the transaction, not the root client.
 let committed: { booking: boolean; tickets: number } = { booking: false, tickets: 0 };
 const failure = new Error("ticket insert failed");
 const tx = {
  event: db.event,
  booking: { findUnique: db.booking.findUnique, aggregate: db.booking.aggregate, create: vi.fn() },
  ticket: { createMany: vi.fn() },
 };
 let rolledBack: unknown;
 let fail = true;
 db.$transaction.mockImplementation(async (callback) => {
  const staged = { ...committed };
  tx.booking.create.mockImplementation(async () => { staged.booking = true; return { number: 42 }; });
  tx.ticket.createMany.mockImplementation(async ({ data }) => {
   staged.tickets += data.length;
   if (fail) throw failure;
   return { count: data.length };
  });
  try {
   const result = await callback(tx);
   committed = staged;
   return result;
  } catch (error) { rolledBack = error; throw error; }
 });
 const data = form();
 const result = await bookPublicEvent("yoga", "event-1", {}, data);
 expect(result.success).toBeUndefined();
 expect(result.message).toContain("nicht abgeschlossen");
 expect(rolledBack).toBe(failure);
 expect(committed).toEqual({ booking: false, tickets: 0 });
 expect(revalidatePath).not.toHaveBeenCalled();
 expect(db.booking.create).not.toHaveBeenCalled();
 expect(db.ticket.createMany).not.toHaveBeenCalled();
 fail = false;
 expect((await bookPublicEvent("yoga", "event-1", {}, data)).success).toBe(true);
 expect(committed).toEqual({ booking: true, tickets: 2 });
});
it.each(["DRAFT", "CANCELLED", "COMPLETED"])("rejects status %s", async (status) => {
 db.event.findFirst.mockResolvedValue({ ...event, status });
 expect((await bookPublicEvent("yoga", "event-1", {}, form())).success).toBeUndefined(); expect(db.booking.create).not.toHaveBeenCalled();
});
it("rejects past or missing events", async () => {
 db.event.findFirst.mockResolvedValue({ ...event, beginsAt: new Date(0) });
 expect((await bookPublicEvent("yoga", "event-1", {}, form())).success).toBeUndefined();
 db.event.findFirst.mockResolvedValue(null);
 expect((await bookPublicEvent("other", "event-1", {}, form())).success).toBeUndefined();
});
it("rejects overbooking and changed prices", async () => {
 db.booking.aggregate.mockResolvedValue({ _sum: { quantity: 9 } });
 expect((await bookPublicEvent("yoga", "event-1", {}, form())).message).toContain("genügend");
 expect((await bookPublicEvent("yoga", "event-1", {}, form(createBookingToken("event-1", "1.00", "EUR")))).message).toContain("Preis");
 expect(db.booking.create).not.toHaveBeenCalled();
});
it("requires authentic unexpired tokens for the correct event", async () => {
 const token = createBookingToken("event-1", "0.00", "EUR");
 expect(readBookingToken(token + "x")).toBeNull();
 expect((await bookPublicEvent("yoga", "other", {}, form(token))).success).toBeUndefined();
 const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 7200000);
 expect(readBookingToken(token)).toBeNull(); now.mockRestore();
 expect(db.$transaction).not.toHaveBeenCalled();
});
it.each([{ name: " " }, { email: "invalid" }, { quantity: "0" }, { quantity: "1.5" }, { quantity: "-2" }])("rejects invalid input %j", async (input) => {
 const data = form(); Object.entries(input).forEach(([key, value]) => data.set(key, value));
 expect((await bookPublicEvent("yoga", "event-1", {}, data)).success).toBeUndefined(); expect(db.$transaction).not.toHaveBeenCalled();
});
it("handles throttling and concurrency conflicts", async () => {
 rate.mockResolvedValue(false);
 expect((await bookPublicEvent("yoga", "event-1", {}, form())).message).toContain("15 Minuten");
 rate.mockResolvedValue(true);
 db.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("conflict", { code: "P2034", clientVersion: "test" }));
 expect((await bookPublicEvent("yoga", "event-1", {}, form())).message).toContain("gleichzeitig");
});
it("renders event details, booking form and sold-out state without exposing customer data", async () => {
 const props = { params: Promise.resolve({ companySlug: "yoga", eventId: "event-1" }) };
 const html = renderToStaticMarkup(await Page(props));
 expect(html).toContain("Yoga"); expect(html).toContain("Jetzt buchen"); expect(html).toContain("7 Plätze verfügbar"); expect(html).toContain("Stripe");
 expect(db.event.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "event-1", status: "PUBLISHED", company: { slug: "yoga" } } }));
 db.booking.aggregate.mockResolvedValue({ _sum: { quantity: 10 } });
 expect(renderToStaticMarkup(await Page(props))).toContain("Ausgebucht");
 db.event.findFirst.mockResolvedValue(null);
 await expect(Page(props)).rejects.toThrow("NOT_FOUND");
});
it("displays only linked trainer first names instead of the legacy text", async () => {
 db.event.findFirst.mockResolvedValue({ ...event, trainerName: "Old trainer", trainers: [{ trainer: { firstName: "Ada", lastName: "Lovelace" } }, { trainer: { firstName: "Grace", lastName: "Hopper" } }] });
 const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ companySlug: "yoga", eventId: "event-1" }) }));
 expect(html).toContain("Ada &amp; Grace"); expect(html).not.toContain("Lovelace"); expect(html).not.toContain("Hopper"); expect(html).not.toContain("Old trainer");
 expect(db.event.findFirst).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ trainers: { orderBy: { trainer: { lastName: "asc" } }, select: { trainer: { select: { firstName: true } } } } }) }));
});
it("uses the event cover image on the booking page", async () => {
 db.event.findFirst.mockResolvedValue({ ...event, imageUrl: "https://res.cloudinary.com/test/image/upload/cover.jpg", eventSeries: { imageUrl: "https://images.example/series.jpg" } });
 const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ companySlug: "yoga", eventId: "event-1" }) }));
 expect(html).toContain('src="https://res.cloudinary.com/test/image/upload/cover.jpg"'); expect(html).not.toContain('src="https://images.example/series.jpg"');
});
