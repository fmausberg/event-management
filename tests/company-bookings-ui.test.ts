// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { CompanyBookings } from "@/app/company/[companyKey]/bookings/table";
vi.mock("@/components/object-notes", () => ({ ObjectNotes: () => null }));
vi.mock("@/components/resend-ticket-email", () => ({ ResendTicketEmail: () => null }));
vi.mock("@/app/company/[companyKey]/events/[eventId]/bookings/_components/bookings-table", () => ({ BookingForm: () => null, RemoveBooking: () => null }));

it("groups strictly by event end, keeps missing ends current, and offers sortable data columns", () => {
  const now = Date.parse("2026-11-11T12:00Z");
  const bookings = [
    { name: "Laufend", end: "2026-11-11T13:00Z" },
    { name: "Beendet", end: "2026-11-11T12:00Z" },
    { name: "Offen", end: null },
  ].map(({ name, end }, index) => ({
    id: String(index), number: index, customerName: "Ada", customerEmail: "ada@example.com", quantity: 1,
    status: "CONFIRMED" as const, bookedAt: "2026-11-01T12:00Z", platform: null, origin: null, externalBookingId: null,
    event: { id: String(index), name, beginsAt: "2026-11-11T10:00Z", endsAt: end, venueName: "Studio Mitte" }, price: null, payment: null, paidAmount: null,
    paymentSummary: "Kein Zahlungsbetrag erfasst", resendUnavailableReason: null,
  }));
  const html = renderToStaticMarkup(createElement(CompanyBookings, {
    company: { id: "company", name: "Demo", slug: "demo" }, bookings, now, selectedBookingId: "1",
    noteSummaries: { userId: "actor", counts: {} },
  }));
  const boundary = html.indexOf("Vergangene Buchungen");
  const current = html.slice(0, boundary), past = html.slice(boundary);
  expect(current).toContain("Aktuelle Buchungen (2)");
  expect(current).toContain("Laufend");
  expect(current).toContain("Offen");
  expect(current).not.toContain("Beendet");
  expect(past).toContain("Beendet");
  expect(past).not.toContain("Laufend");
  expect(html.match(/aria-sort=/g)).toHaveLength(16);
  expect(html).toContain('aria-sort="descending"');
  expect(html).toContain('href="/company/demo/events/0"');
  expect(html).toContain("Person");
  const person = html.match(/<th scope="row"[^>]*>(.*?)<\/th>/)?.[1];
  expect(person).toContain(">Ada</p>");
  expect(person).toContain(">ada@example.com</p>");
  const row = html.match(/<tbody><tr[^>]*>(.*?)<\/tr>/)?.[1] ?? "";
  expect(row.match(/<(td|th)\b/g)).toHaveLength(9);
  expect(html).toContain("Studio Mitte");
  expect(html).toContain("11.11.26, 11:00 Uhr");
  expect(html).toContain("bg-green-100 text-green-800");
  expect(past).toContain('aria-current="true"');
  expect(current).not.toContain('aria-current="true"');
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const scroll = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scroll });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    act(() => root.render(createElement(CompanyBookings, {
      company: { id: "company", name: "Demo", slug: "demo" }, bookings, now, selectedBookingId: "1",
      noteSummaries: { userId: "actor", counts: {} },
    })));
    expect(scroll).toHaveBeenCalledWith({ block: "center" });
    expect(document.activeElement).toBe(host.querySelector('[aria-current="true"]'));
    act(() => root.render(createElement(CompanyBookings, {
      company: { id: "company", name: "Demo", slug: "demo" }, bookings, now, selectedBookingId: "missing",
      noteSummaries: { userId: "actor", counts: {} },
    })));
    expect(host.textContent).toContain("Die verlinkte Buchung wurde nicht gefunden.");
  } finally {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
