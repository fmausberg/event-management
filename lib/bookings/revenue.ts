import { Prisma } from "@prisma/client";

type RevenueBooking = {
  status: string;
  quantity: number;
  payment?: { status: string; amount: number; currency: string } | null;
  price?: { payableAmountMinor: number; originalAmountMinor: number; currency: string } | null;
};
export type EventRevenue = {
  listGross: string | null; listDifference: string | null;
  gross: string; vat: string; stripeFees: string; net: string; vatRate: number;
  bookingCount: number; excludedCount: number;
};

/** Internal calculation using the company's requested rates, not a tax statement. */
export function calculateEventRevenue(bookings: RevenueBooking[], countryCode?: string | null, event?: { ticketPrice?: { toString(): string } | null; currency?: string }): EventRevenue {
  const vatRate = countryCode?.trim().toUpperCase() === "AT" ? 20 : 19;
  let gross = new Prisma.Decimal(0);
  let listGross = new Prisma.Decimal(0);
  let listComplete = true;
  let bookingCount = 0, excludedCount = 0;
  for (const booking of bookings) {
    if (booking.status !== "CONFIRMED") continue;
    // Include complimentary and discounted seats at their original full price.
    // Legacy bookings without a snapshot use the current event price.
    if (booking.price) {
      if (booking.price.currency.toUpperCase() === "EUR") listGross = listGross.plus(new Prisma.Decimal(booking.price.originalAmountMinor).div(100));
      else listComplete = false;
    } else if (event?.ticketPrice != null && event.currency?.toUpperCase() === "EUR") {
      listGross = listGross.plus(new Prisma.Decimal(event.ticketPrice.toString()).times(booking.quantity));
    } else listComplete = false;
    if (booking.payment) {
      // Partial refund amounts are not stored locally: never invent a remainder.
      if (booking.payment.status === "PARTIALLY_REFUNDED") { excludedCount++; continue; }
      if (booking.payment.status !== "PAID") continue;
      if (booking.payment.currency.toUpperCase() !== "EUR") { excludedCount++; continue; }
      gross = gross.plus(new Prisma.Decimal(booking.payment.amount).div(100));
    } else {
      // A stored zero balance is intentional; no Stripe fees or missing-payment warning.
      if (booking.price?.payableAmountMinor === 0) continue;
      excludedCount++;
      continue;
    }
    bookingCount++;
  }
  const rounded = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  gross = rounded(gross);
  const vat = rounded(gross.times(vatRate).div(100));
  const stripeFees = rounded(gross.times("0.015").plus(new Prisma.Decimal(bookingCount).times("0.25")));
  listGross = rounded(listGross);
  return { listGross: listComplete ? listGross.toFixed(2) : null, listDifference: listComplete ? listGross.minus(gross).toFixed(2) : null,
    gross: gross.toFixed(2), vat: vat.toFixed(2), stripeFees: stripeFees.toFixed(2), net: gross.minus(vat).minus(stripeFees).toFixed(2), vatRate, bookingCount, excludedCount };
}
