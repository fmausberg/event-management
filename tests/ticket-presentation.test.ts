import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { POST } from "@/app/api/public-ticket/route";
import MyTicketPage from "@/app/account/tickets/[ticketId]/page";
import { getMyTicket } from "@/lib/tickets/account";
import { encryptTicketCode } from "@/lib/tickets/code-encryption";
import { createHash } from "node:crypto";
import { TicketCard } from "@/components/ticket-card";

const { auth, findFirst, findUnique, upsert, deleteMany } = vi.hoisted(() => ({ auth: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => ({ ticket: { findFirst, findUnique }, authRateLimit: { upsert, deleteMany } }) }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("LOGIN"); }, notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/components/resend-ticket-email", () => ({ ResendTicketEmail: () => null }));
vi.mock("@/components/refresh-status-button", () => ({ RefreshStatusButton: () => null }));

const token = Buffer.alloc(32, 4).toString("base64url");
const hash = createHash("sha256").update(token).digest("hex");
const event = { name: "Yoga", beginsAt: new Date("2026-10-25T01:30:00Z"), status: "PUBLISHED", venue: { name: "Studio", addressLine1: "Teststraße 1", addressLine2: "Hof", postalCode: "41460", city: "Neuss" } };
const ticket = { publicTokenHash: hash, encryptedPublicToken: "", id: "ticket-1", number: 7, status: "VALID", checkedInAt: null, booking: { customerEmail: "owner@example.com", tickets: [{ id: "ticket-1" }], number: 42, status: "CONFIRMED", event } };
const page = () => MyTicketPage({ params: Promise.resolve({ ticketId: "ticket-1" }) });
beforeEach(() => {
  vi.stubEnv("TICKET_CODE_ENCRYPTION_KEYS", JSON.stringify({ active: "k1", keys: { k1: Buffer.alloc(32, 7).toString("base64") } }));

  vi.resetAllMocks();
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-24T12:00:00Z"));
  vi.stubEnv("AUTH_SECRET", "test-secret");
  auth.mockResolvedValue({ user: { id: "owner" } });
  upsert.mockResolvedValue({ attempts: 1 });
  ticket.encryptedPublicToken = encryptTicketCode(token, hash);
  findFirst.mockResolvedValue(ticket); findUnique.mockResolvedValue(ticket);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

it.each([
  [ticket, "Gültig"],
  [{ ...ticket, status: "CANCELLED" }, "Storniert"],
  [{ ...ticket, booking: { ...ticket.booking, status: "CANCELLED" } }, "Storniert"],
  [{ ...ticket, booking: { ...ticket.booking, event: { ...event, status: "CANCELLED" } } }, "Storniert"],
  [{ ...ticket, checkedInAt: new Date("2026-10-25T01:35:15Z") }, "Bereits eingelöst"],
  [{ ...ticket, status: "CANCELLED", checkedInAt: new Date("2026-10-25T01:35:15Z") }, "Storniert"],
  [{ ...ticket, booking: { ...ticket.booking, status: "PENDING_PAYMENT" } }, "Nicht gültig"],
  [{ ...ticket, booking: { ...ticket.booking, status: "EXPIRED" } }, "Nicht gültig"],
])("returns identical display data through both access paths: %s", async (record, status) => {
  findFirst.mockResolvedValue({ ...record, encryptedPublicToken: ticket.encryptedPublicToken }); findUnique.mockResolvedValue(record);
  const account = await getMyTicket("ticket-1");
  const response = await POST(new Request("https://example.com/api/public-ticket", { method: "POST", body: token }));
  const publicTicket = await response.json();
  expect(publicTicket).toEqual(account!.ticket);
  expect(publicTicket.status).toBe(status);
  expect(publicTicket.venue).toBe("Studio, Teststraße 1, Hof, 41460 Neuss");
  expect(publicTicket).not.toHaveProperty("id");
  expect(publicTicket).not.toHaveProperty("bookingNumber");
  expect(publicTicket).not.toHaveProperty("publicTokenHash");
  expect(account!.bookingNumber).toBe(42);
});

it("handles missing dates and venues without dangling timezone labels", async () => {
  findFirst.mockResolvedValue({ ...ticket, booking: { ...ticket.booking, event: { ...event, beginsAt: null, venue: null } } });
  const account = (await getMyTicket("ticket-1"))!;
  const html = renderToStaticMarkup(createElement(TicketCard, { ticket: account.ticket, qrCode: null }));
  expect(html).toContain("Termin noch offen");
  expect(html).not.toContain("Uhr (Berlin)");
  expect(html).not.toContain("<svg");
});

it("uses the same status and timezone rendering, preserving check-in seconds", async () => {
  findFirst.mockResolvedValue({ ...ticket, checkedInAt: new Date("2026-10-25T01:35:15Z") });
  const account = (await getMyTicket("ticket-1"))!;
  const html = renderToStaticMarkup(createElement(TicketCard, { ticket: account.ticket, qrCode: null }));
  expect(html).toContain("25.10.2026");
  expect(html).toContain("02:30");
  expect(html).toContain("02:35:15");
  expect(html).toContain("Bereits eingelöst");
});

it("renders the identical stored QR code for public and owner access without expiry", async () => {
  const account = (await getMyTicket("ticket-1"))!;

  const publicHtml = renderToStaticMarkup(createElement(TicketCard, { ticket: account.ticket, qrCode: { value: token } }));
  const accountHtml = renderToStaticMarkup(await page());
  const expectedAccount = renderToStaticMarkup(createElement(TicketCard, { ticket: account.ticket, bookingNumber: 42, qrCode: { value: account.code! } }));
  expect(accountHtml).toContain(expectedAccount);
  expect(publicHtml).toContain("<svg");
  expect(publicHtml).not.toContain("QR-Code gültig bis");
  expect(accountHtml).not.toContain("QR-Code gültig bis");
  // Both access paths render exactly the same QR matrix.
  expect(publicHtml.match(/<path[^>]+d="([^"]+)"/g)).toEqual(accountHtml.match(/<path[^>]+d="([^"]+)"/g));
});

it.each([
  { ...ticket, status: "CANCELLED" },
  { ...ticket, checkedInAt: new Date() },
  { ...ticket, booking: { ...ticket.booking, status: "EXPIRED" } },
])("keeps the account QR hidden for unusable tickets while allowing the existing public QR", async (record) => {
  findFirst.mockResolvedValue(record);
  expect(renderToStaticMarkup(await page())).not.toContain("<svg");
  const account = (await getMyTicket("ticket-1"))!;
  const html = renderToStaticMarkup(createElement(TicketCard, { ticket: account.ticket, qrCode: { value: token } }));
  expect(html).toContain("<svg");
  expect(html).not.toContain("Zeige diesen QR-Code beim Einlass vor.");
});

it("keeps login redirects and identical 404 handling for missing or foreign account tickets", async () => {
  auth.mockResolvedValue(null);
  await expect(page()).rejects.toThrow("LOGIN");
  expect(findFirst).not.toHaveBeenCalled();
  auth.mockResolvedValue({ user: { id: "owner" } }); findFirst.mockResolvedValue(null);
  await expect(page()).rejects.toThrow("NOT_FOUND");
  expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "ticket-1", booking: { userId: "owner" } } }));
});
