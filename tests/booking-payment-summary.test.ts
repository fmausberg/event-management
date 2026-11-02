import { expect, it } from "vitest";
import { bookingPaymentSummary } from "@/lib/bookings/payment-summary";

const event = { ticketPrice: "100.00", currency: "EUR" };
const booking = { quantity: 2, payment: { status: "PAID", amount: 18000, currency: "EUR" } };
it("shows a recorded full discount without a Stripe payment", () => {
  expect(bookingPaymentSummary({ quantity: 2, price: { originalAmountMinor: 20000, payableAmountMinor: 0, currency: "EUR" } }, event).replaceAll("\u00a0", " ")).toBe("0,00 € (-100 %)");
});
it("compares the actual payment with the list price for all tickets", () => {
  expect(bookingPaymentSummary(booking, event).replaceAll("\u00a0", " ")).toBe("180,00 € (-10 %)");
});
it("uses the original price snapshot after event price changes", () => {
  expect(bookingPaymentSummary({ ...booking, price: { originalAmountMinor: 20000, currency: "EUR" } }, { ...event, ticketPrice: "150.00" })).toContain("-10");
});
it("does not count pending payments as paid", () => {
  expect(bookingPaymentSummary({ ...booking, payment: { ...booking.payment, status: "PENDING" } }, event)).toContain("-100");
});
it("distinguishes missing amounts and unknown refund remainders", () => {
  expect(bookingPaymentSummary({ quantity: 2 }, event)).toBe("Kein Zahlungsbetrag erfasst");
  expect(bookingPaymentSummary({ ...booking, payment: { ...booking.payment, status: "PARTIALLY_REFUNDED" } }, event)).toContain("Restbetrag unbekannt");
});
it("handles zero prices and overpayments", () => {
  expect(bookingPaymentSummary(booking, { ...event, ticketPrice: "0" })).toContain("nicht vergleichbar");
  expect(bookingPaymentSummary({ ...booking, payment: { ...booking.payment, amount: 22000 } }, event)).toContain("+10");
});
