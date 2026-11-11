import { expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { calculateEventRevenue } from "@/lib/bookings/revenue";

it.each(["DE", "AT", null, "CH"])("never invents legacy tax from %s", country => {
  const revenue = calculateEventRevenue([{ status: "CONFIRMED", quantity: 1, payment: { status: "PAID", amount: 10000, currency: "EUR" } }], country);
  expect(revenue).toMatchObject({ vatRate: null, vat: null, net: null, unknownTaxCount: 1 });
});
import { EventRevenueSummary } from "@/app/company/[companyKey]/events/[eventId]/bookings/_components/event-revenue";

const paid = (amount: number) => ({ status: "CONFIRMED", quantity: 1, payment: { status: "PAID", amount, currency: "EUR" } });
it("compares all confirmed seats at list price, including free tickets and legacy bookings", () => {
  const discounted = { ...paid(18000), quantity: 2, price: { payableAmountMinor: 18000, originalAmountMinor: 20000, currency: "EUR" } };
  const complimentary = { status: "CONFIRMED", quantity: 1, price: { payableAmountMinor: 0, originalAmountMinor: 10000, currency: "EUR" } };
  const legacy = { ...paid(20000), quantity: 2 };
  const revenue = calculateEventRevenue([discounted, complimentary, legacy,
    ...["CANCELLED", "EXPIRED", "PENDING_PAYMENT"].map(status => ({ ...discounted, status })),
  ], "DE", { ticketPrice: "100.00", currency: "EUR" });
  expect(revenue).toMatchObject({ listGross: "500.00", gross: "380.00", listDifference: "120.00", bookingCount: 2, excludedCount: 0 });
  const html = renderToStaticMarkup(createElement(EventRevenueSummary, { revenue }));
  expect(html.indexOf("Umsatz zum Listenpreis")).toBeLessThan(html.indexOf(">Bruttoumsatz<"));
  expect(html).toContain("500,00");
  expect(html).toContain("Differenz zum Bruttoumsatz: 120,00");
});

it("keeps historical list prices after the event price changes", () => {
  const revenue = calculateEventRevenue([{ ...paid(18000), quantity: 2, price: { payableAmountMinor: 18000, originalAmountMinor: 20000, currency: "EUR" } }], "DE", { ticketPrice: "150.00", currency: "EUR" });
  expect(revenue).toMatchObject({ listGross: "200.00", listDifference: "20.00" });
});

it("does not present incomplete or mixed-currency list totals as a complete comparison", () => {
  for (const booking of [paid(10000), { ...paid(10000), price: { payableAmountMinor: 10000, originalAmountMinor: 10000, currency: "USD" } }]) {
    const revenue = calculateEventRevenue([booking]);
    expect(revenue).toMatchObject({ listGross: null, listDifference: null, gross: "100.00" });
    expect(renderToStaticMarkup(createElement(EventRevenueSummary, { revenue }))).toContain("Nicht verfügbar");
  }
});

it("uses decimal arithmetic for legacy quantities and preserves a negative difference", () => {
  const revenue = calculateEventRevenue([{ ...paid(6010), quantity: 3 }], "DE", { ticketPrice: "19.99", currency: "EUR" });
  expect(revenue).toMatchObject({ listGross: "59.97", listDifference: "-0.13" });
});
it("does not invent revenue, fees or missing-payment warnings for complimentary tickets", () => {
  const revenue = calculateEventRevenue([{ status: "CONFIRMED", quantity: 1, payment: null, price: { payableAmountMinor: 0, originalAmountMinor: 10000, currency: "EUR" } }]);
  expect(revenue).toMatchObject({ gross: "0.00", stripeFees: "0.00", net: null, excludedCount: 0 });
});

it("uses stored booking totals and charges the flat fee per booking, not per ticket", () => {
  const bookings = [{ ...paid(6000), quantity: 3 }, { ...paid(4000), quantity: 2 }];
  const result = calculateEventRevenue(bookings);
  expect(result).toMatchObject({ listGross: null, listDifference: null, gross: "100.00", vat: null, stripeFees: "2.00", net: null, bookingCount: 2, excludedCount: 0, vatRate: null });
});
it("excludes manual bookings, unpaid or refunded payments and inactive bookings", () => {
  const result = calculateEventRevenue([
    paid(2000), { status: "CONFIRMED", quantity: 1, payment: null },
    ...["PENDING", "EXPIRED", "REFUNDED"].map((status) => ({ ...paid(2000), payment: { ...paid(2000).payment, status } })),
    ...["PENDING_PAYMENT", "EXPIRED", "CANCELLED"].map((status) => ({ ...paid(2000), status })),
  ]);
  expect(result).toMatchObject({ listGross: null, listDifference: null, gross: "20.00", vat: null, stripeFees: "0.55", net: null, bookingCount: 1, excludedCount: 1, vatRate: null });
});
it("does not mix currencies or invent partial-refund amounts", () => {
  const result = calculateEventRevenue([
    { ...paid(2000), payment: { ...paid(2000).payment, currency: "USD" } },
    { ...paid(2000), payment: { ...paid(2000).payment, status: "PARTIALLY_REFUNDED" } },
  ]);
  expect(result.gross).toBe("0.00"); expect(result.excludedCount).toBe(2); expect(result.stripeFees).toBe("0.00");
});
it("rounds deductions to cents and subtracts the displayed rounded values", () => {
  expect(calculateEventRevenue([taxed(1999, 319)])).toMatchObject({ gross: "19.99", vat: "3.19", stripeFees: "0.55", net: "16.25" });
  expect(calculateEventRevenue([taxed(100, 16)])).toMatchObject({ stripeFees: "0.27", net: "0.57" });
});
it("renders the five calculations and explains excluded amounts", () => {
  const html = renderToStaticMarkup(createElement(EventRevenueSummary, { revenue: calculateEventRevenue([taxed(10000, 1597), { status: "CONFIRMED", quantity: 1, payment: null }]) }));
  for (const label of ["Bruttoumsatz", "Enthaltene Steuer", "Stripe-Gebühren", "Nettoumsatz", "100,00", "15,97", "1,75", "82,28", "1 bestätigte Buchungen sind nicht eingerechnet"]) expect(html).toContain(label);
});
it("shows zero totals for an empty event", () => {
  expect(calculateEventRevenue([])).toMatchObject({ listGross: "0.00", listDifference: "0.00", gross: "0.00", vat: "0.00", stripeFees: "0.00", net: "0.00", bookingCount: 0, excludedCount: 0, vatRate: null });
});

function taxed(amount: number, taxMinor: number, rate = "19") {
 return { ...paid(amount), price: { payableAmountMinor: amount, originalAmountMinor: amount, currency: "EUR", taxMinor, taxRate: rate, taxGrossMinor: amount, taxCalculationVersion: 1 } };
}
it("adds the actual mixed-rate snapshots", () => {
 expect(calculateEventRevenue([taxed(11900, 1900), taxed(10700, 700, "7")])).toMatchObject({ gross: "226.00", vat: "26.00", vatRate: null, taxRates: ["19", "7"] });
});
it("does not render tax revenue fields for Company Users", () => {
 const { vat, vatRate, net, taxGross, unknownTaxCount, taxRates, ...publicRevenue } = calculateEventRevenue([taxed(11900, 1900)]);
 const html = renderToStaticMarkup(createElement(EventRevenueSummary, { revenue: publicRevenue }));
 expect(html).not.toContain("Enthaltene Steuer"); expect(html).not.toContain("Nettoumsatz");
 expect(html).toContain("119,00");
});
