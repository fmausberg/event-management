import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { calculateEventRevenue } from "@/lib/bookings/revenue";
import { EventRevenueSummary } from "@/app/company/[companyKey]/events/[eventId]/bookings/_components/event-revenue";

const paid = (amount: number) => ({ status: "CONFIRMED", payment: { status: "PAID", amount, currency: "EUR" } });

it("uses stored booking totals and charges the flat fee per booking, not per ticket", () => {
  const bookings = [{ ...paid(6000), quantity: 3 }, { ...paid(4000), quantity: 2 }];
  const result = calculateEventRevenue(bookings);
  expect(result).toEqual({ gross: "100.00", vat: "19.00", stripeFees: "2.00", net: "79.00", bookingCount: 2, excludedCount: 0 });
});
it("excludes manual bookings, unpaid or refunded payments and inactive bookings", () => {
  const result = calculateEventRevenue([
    paid(2000), { status: "CONFIRMED", payment: null },
    ...["PENDING", "EXPIRED", "REFUNDED"].map((status) => ({ ...paid(2000), payment: { ...paid(2000).payment, status } })),
    ...["PENDING_PAYMENT", "EXPIRED", "CANCELLED"].map((status) => ({ ...paid(2000), status })),
  ]);
  expect(result).toEqual({ gross: "20.00", vat: "3.80", stripeFees: "0.55", net: "15.65", bookingCount: 1, excludedCount: 1 });
});
it("does not mix currencies or invent partial-refund amounts", () => {
  const result = calculateEventRevenue([
    { ...paid(2000), payment: { ...paid(2000).payment, currency: "USD" } },
    { ...paid(2000), payment: { ...paid(2000).payment, status: "PARTIALLY_REFUNDED" } },
  ]);
  expect(result.gross).toBe("0.00"); expect(result.excludedCount).toBe(2); expect(result.stripeFees).toBe("0.00");
});
it("rounds deductions to cents and subtracts the displayed rounded values", () => {
  expect(calculateEventRevenue([paid(1999)])).toMatchObject({ gross: "19.99", vat: "3.80", stripeFees: "0.55", net: "15.64" });
  expect(calculateEventRevenue([paid(100)])).toMatchObject({ stripeFees: "0.27", net: "0.54" });
});
it("renders the four calculations and explains excluded amounts", () => {
  const html = renderToStaticMarkup(createElement(EventRevenueSummary, { revenue: calculateEventRevenue([paid(10000), { status: "CONFIRMED", payment: null }]) }));
  for (const label of ["Bruttoumsatz", "MwSt.", "Stripe-Gebühren", "Nettoumsatz", "100,00", "19,00", "1,75", "79,25", "1 bestätigte Buchungen sind nicht eingerechnet"]) expect(html).toContain(label);
});
it("shows zero totals for an empty event", () => {
  expect(calculateEventRevenue([])).toEqual({ gross: "0.00", vat: "0.00", stripeFees: "0.00", net: "0.00", bookingCount: 0, excludedCount: 0 });
});
