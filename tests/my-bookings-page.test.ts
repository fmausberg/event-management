import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MyBookingsPage from "@/app/account/bookings/page";

const { getMyBookings } = vi.hoisted(() => ({ getMyBookings: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/cancellations/data", () => ({ getMyBookings }));
vi.mock("@/components/refresh-status-button", () => ({ RefreshStatusButton: () => null }));
vi.mock("@/app/account/bookings/actions", () => ({ cancellationAction: vi.fn() }));

const booking = {
  id: "booking", number: 42, quantity: 1, status: "CONFIRMED", payment: { status: "PAID" }, cancellationRequests: [],
  event: { id: "event", name: "Yoga am Abend", status: "PUBLISHED", beginsAt: new Date("2099-05-05T16:00Z"), endsAt: new Date("2099-05-05T17:30Z"), freeCancellationUntilMinutesBeforeStart: 1440,
    company: { name: "Yoga", slug: "yoga" }, venue: { name: "Studio", addressLine1: "Teststraße 1", addressLine2: null, postalCode: "41460", city: "Neuss", countryCode: "DE" } },
  tickets: [{ id: "ticket", number: 7, status: "VALID" }],
};
beforeEach(() => { vi.resetAllMocks(); getMyBookings.mockResolvedValue([booking]); });
it("shows requested event information and links, with cancellation form initially hidden", async () => {
  const html = renderToStaticMarkup(await MyBookingsPage());
  for (const value of ["Yoga am Abend", "Buchung #42", "1 Std. 30 Min.", "Teststraße 1", "41460 Neuss", 'href="/events/yoga/event"', 'href="/account/tickets/ticket"', "Ticket #7", "Kostenfrei bis 1 Tag vor Beginn", "Stornieren", 'aria-expanded="false"']) expect(html).toContain(value);
  expect(html).not.toContain("textarea");
  expect(html.indexOf("Kommende Events")).toBeLessThan(html.indexOf("Vergangene Events"));
});
it("retains past cancelled bookings and refund information without a cancellation button", async () => {
  getMyBookings.mockResolvedValue([{ ...booking, status: "CANCELLED", event: { ...booking.event, beginsAt: new Date("2020-05-05T16:00Z"), endsAt: new Date("2020-05-05T17:30Z") }, cancellationRequests: [{ id: "request", status: "APPROVED", requestedAt: new Date(), decidedAt: new Date(), refundStatus: "PENDING" }] }]);
  const html = renderToStaticMarkup(await MyBookingsPage());
  expect(html).toContain("Erstattung ausstehend");
  expect(html).toContain("Storniert");
  expect(html).not.toContain('aria-expanded="false"');
  expect(html.indexOf("Vergangene Events")).toBeLessThan(html.indexOf("Yoga am Abend"));
});
