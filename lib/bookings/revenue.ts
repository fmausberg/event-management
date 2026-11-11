import { Prisma } from "@prisma/client";

type RevenueBooking = {
  status: string;
  quantity: number;
  payment?: { status: string; amount: number; currency: string } | null;
  price?: { payableAmountMinor: number; originalAmountMinor: number; currency: string; taxMinor?: number | null; taxRate?: { toString(): string } | null; taxGrossMinor?: number | null; taxCalculationVersion?: number | null; voucherAmountMinor?: number } | null;
};
export type EventRevenue = {
  listGross: string | null; listDifference: string | null;
  gross: string; vat?: string | null; stripeFees: string; net?: string | null; vatRate?: number | null; taxGross?: string; unknownTaxCount?: number; taxRates?: string[];
  bookingCount: number; excludedCount: number;
};

/** Internal calculation using the company's requested rates, not a tax statement. */
export function calculateEventRevenue(bookings: RevenueBooking[], countryCode?: string | null, event?: { ticketPrice?: { toString(): string } | null; currency?: string }): EventRevenue {
  void countryCode; // Venue country never reconstructs historical tax.
  let vat = new Prisma.Decimal(0);
  let unknownTaxCount = 0;
  const rates = new Set<string>();
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
      if (booking.price?.payableAmountMinor === 0) {
        if (booking.price.taxCalculationVersion === 1 && booking.price.taxMinor != null && booking.price.taxRate != null) {
          vat = vat.plus(new Prisma.Decimal(booking.price.taxMinor).div(100));
          rates.add(booking.price.taxRate.toString());
        } else unknownTaxCount++;
        continue;
      }
      excludedCount++;
      continue;
    }
    if (booking.price?.taxCalculationVersion === 1 && booking.price.taxMinor != null && booking.price.taxRate != null) {
      vat = vat.plus(new Prisma.Decimal(booking.price.taxMinor).div(100));
      rates.add(booking.price.taxRate.toString());
    } else unknownTaxCount++;
    bookingCount++;
  }
  const rounded = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  gross = rounded(gross);
  vat = rounded(vat);
  const stripeFees = rounded(gross.times("0.015").plus(new Prisma.Decimal(bookingCount).times("0.25")));
  listGross = rounded(listGross);
  return { listGross: listComplete ? listGross.toFixed(2) : null, listDifference: listComplete ? listGross.minus(gross).toFixed(2) : null,
    gross: gross.toFixed(2), vat: unknownTaxCount ? null : vat.toFixed(2), stripeFees: stripeFees.toFixed(2), net: unknownTaxCount ? null : gross.minus(vat).minus(stripeFees).toFixed(2), vatRate: rates.size === 1 ? Number([...rates][0]) : null, taxGross: gross.toFixed(2), unknownTaxCount, taxRates: [...rates].sort(), bookingCount, excludedCount };
}
