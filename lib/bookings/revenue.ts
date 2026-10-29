import { Prisma } from "@prisma/client";

type RevenueBooking = {
  status: string;
  payment?: { status: string; amount: number; currency: string } | null;
};
export type EventRevenue = {
  gross: string; vat: string; stripeFees: string; net: string;
  bookingCount: number; excludedCount: number;
};

/** Internal calculation using the company's requested rates, not a tax statement. */
export function calculateEventRevenue(bookings: RevenueBooking[]): EventRevenue {
  let gross = new Prisma.Decimal(0);
  let bookingCount = 0, excludedCount = 0;
  for (const booking of bookings) {
    if (booking.status !== "CONFIRMED") continue;
    if (booking.payment) {
      // Partial refund amounts are not stored locally: never invent a remainder.
      if (booking.payment.status === "PARTIALLY_REFUNDED") { excludedCount++; continue; }
      if (booking.payment.status !== "PAID") continue;
      if (booking.payment.currency.toUpperCase() !== "EUR") { excludedCount++; continue; }
      gross = gross.plus(new Prisma.Decimal(booking.payment.amount).div(100));
    } else {
      excludedCount++;
      continue;
    }
    bookingCount++;
  }
  const rounded = (value: Prisma.Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  gross = rounded(gross);
  const vat = rounded(gross.times("0.19"));
  const stripeFees = rounded(gross.times("0.015").plus(new Prisma.Decimal(bookingCount).times("0.25")));
  return { gross: gross.toFixed(2), vat: vat.toFixed(2), stripeFees: stripeFees.toFixed(2), net: gross.minus(vat).minus(stripeFees).toFixed(2), bookingCount, excludedCount };
}
