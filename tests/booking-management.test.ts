import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { decryptPaymentMail } from "@/lib/payments/mail";
import { decryptTicketCode } from "@/lib/tickets/code-encryption";
import { deliverTicketMail } from "@/lib/tickets/outbox";
import { Prisma } from "@prisma/client";
import { renderToStaticMarkup } from "react-dom/server";
import { saveBooking, deleteBooking } from "@/app/company/[companyKey]/events/[eventId]/bookings/actions";
import Page from "@/app/company/[companyKey]/events/[eventId]/bookings/page";
import EventsPage from "@/app/company/[companyKey]/events/page";
import { saveEvent } from "@/app/company/[companyKey]/events/actions";
import { getEventBookings } from "@/lib/bookings/management";
const { auth, db } = vi.hoisted(() => ({ auth: vi.fn(), db: {
 user: { findUnique: vi.fn() }, company: { findUnique: vi.fn() }, companyMembership: { findUnique: vi.fn() },
 trainer: { findMany: vi.fn() },
 bookingPrice: { create: vi.fn() }, ticket: { createMany: vi.fn() }, ticketMail: { create: vi.fn() },
 event: { findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn() }, eventSeries: { findMany: vi.fn() }, venue: { findMany: vi.fn() },
 booking: { findMany: vi.fn(), findFirst: vi.fn(), aggregate: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() }, $transaction: vi.fn(),
} }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/tickets/outbox", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/tickets/outbox")>(), deliverTicketMail: vi.fn() }));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("LOGIN"); }, notFound: () => { throw new Error("NOT_FOUND"); } }));
function form(overrides: Record<string, string> = {}) { const data = new FormData(); Object.entries({ customerName: " Ada ", customerEmail: " ADA@example.com ", quantity: "2", status: "CONFIRMED", confirmed: "yes", ...overrides }).forEach(([key, value]) => data.set(key, value)); return data; }
beforeEach(() => {
 vi.stubEnv("AUTH_SECRET", "manual-booking-test-secret");
 vi.stubEnv("AUTH_URL", "https://events.example.com");
 vi.stubEnv("TICKET_CODE_ENCRYPTION_KEYS", JSON.stringify({ active: "test", keys: { test: Buffer.alloc(32, 7).toString("base64") } }));
 vi.resetAllMocks(); auth.mockResolvedValue({ user: { id: "actor" } }); db.user.findUnique.mockResolvedValue({ role: "USER" });
 db.company.findUnique.mockResolvedValue({ id: "company-id", slug: "yoga", name: "Yoga" });
 db.companyMembership.findUnique.mockResolvedValue({ role: "COMPANY_USER", status: "ACTIVE" });
 db.event.findFirst.mockResolvedValue({ id: "event-1", name: "Yoga", maxSeats: 10, beginsAt: new Date("2026-10-14T08:00:00Z") }); db.event.findUniqueOrThrow.mockResolvedValue({ maxSeats: 10, companyId: "company-id", name: "Yoga", beginsAt: new Date("2026-10-14T08:00:00Z"), status: "PUBLISHED", ticketPrice: new Prisma.Decimal(100), currency: "EUR" });
 db.booking.create.mockImplementation(async ({ data }) => ({ id: "new-booking", number: 42, ...data }));
 db.ticketMail.create.mockResolvedValue({ id: "mail-1" });
 vi.mocked(deliverTicketMail).mockResolvedValue(true);
 db.booking.findMany.mockResolvedValue([]); db.booking.aggregate.mockResolvedValue({ _sum: { quantity: 5 } });
 db.booking.findFirst.mockResolvedValue({ id: "booking-1", quantity: 1, status: "CONFIRMED" }); db.booking.deleteMany.mockResolvedValue({ count: 1 });
 db.$transaction.mockImplementation(async (callback) => callback(db));
 db.event.findMany.mockResolvedValue([]); db.eventSeries.findMany.mockResolvedValue([]); db.venue.findMany.mockResolvedValue([]); db.trainer.findMany.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());
it.each(["COMPANY_USER", "COMPANY_ADMIN"])("allows active %s and normalizes manual bookings", async (role) => {
 db.companyMembership.findUnique.mockResolvedValue({ role, status: "ACTIVE" });
 expect((await saveBooking("yoga", "event-1", null, {}, form({ userId: "injected", eventId: "foreign", platform: "EVENTBRITE" }))).success).toBe(true);
 expect(db.booking.create).toHaveBeenCalledWith({ data: { customerName: "Ada", customerEmail: "ada@example.com", quantity: 2, status: "CONFIRMED", eventId: "event-1", platform: null, externalBookingId: null } });
 expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
 expect(db.bookingPrice.create).toHaveBeenCalledWith({ data: {
  bookingId: "new-booking", eventId: "event-1", companyId: "company-id", currency: "EUR",
  unitPriceMinor: 10000, quantity: 2, originalAmountMinor: 20000, discountAmountMinor: 20000,
  voucherAmountMinor: 0, payableAmountMinor: 0, calculationVersion: 1,
 } });
 const tickets = db.ticket.createMany.mock.calls[0][0].data;
 expect(tickets).toHaveLength(2);
 expect(new Set(tickets.map((ticket: { publicTokenHash: string }) => ticket.publicTokenHash)).size).toBe(2);
 const mail = decryptPaymentMail(db.ticketMail.create.mock.calls[0][0].data.encryptedMessage);
 expect(mail.to).toBe("ada@example.com");
 expect(mail.text).toContain("https://events.example.com/booking/manage#");
 expect(mail.text).toContain("vielen Dank für deine Buchung");
 for (const ticket of tickets) {
  expect(ticket).toMatchObject({ bookingId: "new-booking", status: "VALID" });
  expect(mail.text).toContain(`https://events.example.com/tickets#${decryptTicketCode(ticket.encryptedPublicToken, ticket.publicTokenHash)}`);
 }
 expect(deliverTicketMail).toHaveBeenCalledWith("mail-1");
});

it("sends only after commit and keeps a successful booking when delivery fails", async () => {
 let committed = false;
 db.$transaction.mockImplementation(async callback => { const result = await callback(db); committed = true; return result; });
 vi.mocked(deliverTicketMail).mockImplementation(async () => { expect(committed).toBe(true); throw new Error("SMTP unavailable"); });
 expect(await saveBooking("yoga", "event-1", null, {}, form())).toMatchObject({ success: true, message: expect.stringContaining("vorgemerkt") });
 expect(db.booking.create).toHaveBeenCalledOnce();
 expect(db.ticketMail.create).toHaveBeenCalledOnce();
});

it.each<Record<string, string>>([{ customerName: "" }, { customerEmail: "" }, { quantity: "101" }, { status: "CANCELLED" }])("rejects incomplete or invalid new ticket bookings %j", async values => {
 expect((await saveBooking("yoga", "event-1", null, {}, form(values))).success).toBeUndefined();
 expect(db.booking.create).not.toHaveBeenCalled();
 expect(deliverTicketMail).not.toHaveBeenCalled();
});

it("shows complimentary bookings with a full discount, resend and cancellation actions", async () => {
 db.booking.findMany.mockResolvedValue([{ id: "free", number: 42, customerName: "Ada", customerEmail: "ada@example.com", quantity: 2,
  status: "CONFIRMED", bookedAt: new Date(), payment: null, price: { originalAmountMinor: 20000, payableAmountMinor: 0, currency: "EUR" },
  platform: null, externalBookingId: null, user: null, tickets: [{ id: "ticket-1" }, { id: "ticket-2" }] }]);
 const result = await getEventBookings("yoga", "event-1");
 expect(result.bookings[0].paymentSummary).toContain("-100");
 expect(result.bookings[0].resendUnavailableReason).toBeNull();
 expect(result.revenue.excludedCount).toBe(0);
 const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ companyKey: "yoga", eventId: "event-1" }) }));
 expect(html).toContain("-100");
 expect(html).toContain("Stornierungen");
 expect(html).not.toContain(">Bearbeiten</button>");
});

it("does not send mail if ticket creation or the transaction fails", async () => {
 db.ticket.createMany.mockRejectedValueOnce(new Error("Ticket creation failed"));
 expect((await saveBooking("yoga", "event-1", null, {}, form())).success).toBeUndefined();
 expect(db.ticketMail.create).not.toHaveBeenCalled();
 expect(deliverTicketMail).not.toHaveBeenCalled();
 db.$transaction.mockImplementation(async callback => { await callback(db); throw new Error("Commit failed"); });
 expect((await saveBooking("yoga", "event-1", null, {}, form())).success).toBeUndefined();
 expect(deliverTicketMail).not.toHaveBeenCalled();
});
it("allows global admins without membership", async () => {
 db.user.findUnique.mockResolvedValue({ role: "ADMIN" }); db.companyMembership.findUnique.mockResolvedValue(null);
 expect((await saveBooking("yoga", "event-1", null, {}, form())).success).toBe(true);
});
it("prevents manual confirmation, changes and cancellation of Stripe bookings", async () => {
 db.booking.findFirst.mockResolvedValue({ id: "booking-1", quantity: 2, status: "PENDING_PAYMENT", payment: { id: "payment-1" } });
 expect((await saveBooking("yoga", "event-1", "booking-1", {}, form())).message).toContain("Stripe");
 expect(db.booking.updateMany).not.toHaveBeenCalled();
});
it.each([null, { role: "COMPANY_ADMIN", status: "INVITED" }, { role: "COMPANY_USER", status: "SUSPENDED" }])("denies insufficient membership %j", async (membership) => {
 db.companyMembership.findUnique.mockResolvedValue(membership);
 expect((await saveBooking("yoga", "event-1", null, {}, form())).success).toBeUndefined();
 expect((await deleteBooking("yoga", "event-1", "booking-1", {}, form())).success).toBeUndefined();
 expect(db.$transaction).not.toHaveBeenCalled(); expect(db.booking.deleteMany).not.toHaveBeenCalled();
 await expect(Page({ params: Promise.resolve({ companyKey: "yoga", eventId: "event-1" }) })).rejects.toThrow("NOT_FOUND");
});
it("scopes the event to company and rejects foreign events", async () => {
 db.event.findFirst.mockResolvedValue(null);
 expect((await saveBooking("yoga", "foreign", null, {}, form())).success).toBeUndefined();
 expect(db.event.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "foreign", companyId: "company-id" } }));
 expect(db.$transaction).not.toHaveBeenCalled();
});
it("scopes booking updates and deletes to event and rejects foreign booking IDs", async () => {
 await saveBooking("yoga", "event-1", "booking-1", {}, form());
 expect(db.booking.updateMany).toHaveBeenCalledWith({ where: { id: "booking-1", eventId: "event-1" }, data: expect.objectContaining({ quantity: 2 }) });
 db.booking.findFirst.mockResolvedValue(null);
 expect((await saveBooking("yoga", "event-1", "foreign", {}, form())).success).toBeUndefined();
 await deleteBooking("yoga", "event-1", "booking-1", {}, form());
 expect(db.booking.deleteMany).toHaveBeenCalledWith({ where: { id: "booking-1", eventId: "event-1", payment: { is: null }, price: { is: null }, voucherRedemption: { is: null }, voucherBalanceUses: { none: {} }, cancellationRequests: { none: {} } } });
 db.booking.deleteMany.mockResolvedValue({ count: 0 });
 expect((await deleteBooking("yoga", "event-1", "foreign", {}, form())).success).toBeUndefined();
});
it("prevents overbooking but permits cancellation and reductions", async () => {
 db.booking.aggregate.mockResolvedValue({ _sum: { quantity: 10 } });
 expect((await saveBooking("yoga", "event-1", null, {}, form())).message).toContain("nicht genügend");
 expect(db.booking.create).not.toHaveBeenCalled();
 expect((await saveBooking("yoga", "event-1", "booking-1", {}, form({ status: "CANCELLED" }))).success).toBe(true);
 db.booking.findFirst.mockResolvedValue({ id: "booking-1", quantity: 5, status: "CONFIRMED" });
 expect((await saveBooking("yoga", "event-1", "booking-1", {}, form())).success).toBe(true);
});
it("returns retry feedback on transaction conflicts", async () => {
 db.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("conflict", { code: "P2034", clientVersion: "test" }));
 expect((await saveBooking("yoga", "event-1", null, {}, form())).message).toContain("gleichzeitig");
});
it.each([{ quantity: "0" }, { quantity: "1.5" }, { customerEmail: "invalid" }, { status: "OTHER" }])("rejects invalid input %j", async (values) => {
 const data = form();
 Object.entries(values).forEach(([key, value]) => { if (typeof value === "string") data.set(key, value); });
 expect((await saveBooking("yoga", "event-1", null, {}, data)).success).toBeUndefined(); expect(db.$transaction).not.toHaveBeenCalled();
});
it("requires deletion confirmation and authentication", async () => {
 expect((await deleteBooking("yoga", "event-1", "booking-1", {}, form({ confirmed: "no" }))).success).toBeUndefined();
 auth.mockResolvedValue(null);
 expect((await saveBooking("yoga", "event-1", null, {}, form())).success).toBeUndefined();
 expect(db.booking.deleteMany).not.toHaveBeenCalled();
 await expect(Page({ params: Promise.resolve({ companyKey: "yoga", eventId: "event-1" }) })).rejects.toThrow("LOGIN");
});
it("renders empty bookings and exposes event management to company users", async () => {
 const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ companyKey: "yoga", eventId: "event-1" }) }));
 expect(html).toContain("Noch keine Buchungen vorhanden"); expect(html).toContain("+ Buchung erstellen");
 const events = renderToStaticMarkup(await EventsPage({ params: Promise.resolve({ companyKey: "yoga" }) }));
 expect(events).toContain("+ Veranstaltung erstellen");
 expect((await saveEvent("yoga", null, {}, form())).success).toBeUndefined();
});
it("shows resend availability from stored booking email rather than the profile fallback", async () => {
 db.event.findFirst.mockResolvedValue({ id: "event-1", name: "Yoga", maxSeats: 10, beginsAt: null, status: "PUBLISHED" });
 const row = { id: "booking-1", number: 42, customerName: "Ada", customerEmail: null, quantity: 1, status: "CONFIRMED", bookedAt: new Date(), payment: null, platform: null, externalBookingId: null, user: { name: "Ada", email: "profile@example.com" }, tickets: [{ id: "ticket-1" }] };
 db.booking.findMany.mockResolvedValue([row]);
 const result = await getEventBookings("yoga", "event-1");
 expect(result.bookings[0].customerEmail).toBe("profile@example.com");
 expect(result.bookings[0].resendUnavailableReason).toContain("Empfängeradresse");
 const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ companyKey: "yoga", eventId: "event-1" }) }));
 expect(html).toContain("Tickets erneut senden"); expect(html).toContain("Empfängeradresse");
 db.booking.findMany.mockResolvedValue([{ ...row, customerEmail: "booking@example.com" }]);
 expect((await getEventBookings("yoga", "event-1")).bookings[0].resendUnavailableReason).toBeNull();
});

it("loads stored payment totals and displays the event revenue above the bookings table", async () => {
 db.booking.findMany.mockResolvedValue([{ id: "paid", number: 1, customerName: "Ada", customerEmail: "ada@example.com", quantity: 2, status: "CONFIRMED", bookedAt: new Date(), payment: { status: "PAID", amount: 4000, currency: "EUR" }, platform: null, externalBookingId: null, user: null, tickets: [] }]);
 const result = await getEventBookings("yoga", "event-1");
 expect(result.revenue).toMatchObject({ gross: "40.00", vat: "7.60", stripeFees: "0.85", net: "31.55", bookingCount: 1 });
 expect(db.booking.findMany.mock.calls[0][0].select.payment).toEqual({ select: { status: true, amount: true, currency: true } });
 const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ companyKey: "yoga", eventId: "event-1" }) }));
 expect(html).toContain("31,55");
 expect(html.indexOf("Kalkulatorische Veranstaltungsumsatzübersicht")).toBeLessThan(html.indexOf("<table"));
});

it("calculates Austrian event revenue using the venue country", async () => {
 db.event.findFirst.mockResolvedValue({ id: "event-1", name: "Yoga", maxSeats: 10, beginsAt: null, venue: { countryCode: "AT" } });
 db.booking.findMany.mockResolvedValue([{ id: "paid", quantity: 1, status: "CONFIRMED", bookedAt: new Date(), payment: { status: "PAID", amount: 10000, currency: "EUR" }, user: null, tickets: [] }]);
 expect((await getEventBookings("yoga", "event-1")).revenue).toMatchObject({ vatRate: 20, vat: "20.00", net: "78.25" });
});

it.each([{ price: { bookingId: "booking-1" } }, { voucherRedemption: { id: "redemption" } }, { voucherBalanceUses: [{ id: "use" }] }])("blocks financial history from manual changes %j", async history => {
 db.booking.findFirst.mockResolvedValue({ id: "booking-1", quantity: 1, status: "CONFIRMED", ...history });
 expect((await saveBooking("yoga", "event-1", "booking-1", {}, form({ status: "CANCELLED" }))).success).toBeUndefined();
 expect(db.booking.updateMany).not.toHaveBeenCalled();
});
