type BookingPayment = {
  quantity: number;
  payment?: { status: string; amount: number; currency: string } | null;
  price?: { originalAmountMinor: number; currency: string; payableAmountMinor?: number } | null;
};

export function bookingPaymentSummary(booking: BookingPayment, event: { ticketPrice?: { toString(): string } | null; currency?: string }) {
  const payment = booking.payment;
  if (!payment && booking.price?.payableAmountMinor !== 0) return "Kein Zahlungsbetrag erfasst";
  if (payment?.status === "PARTIALLY_REFUNDED") return "Teilweise erstattet – Restbetrag unbekannt";
  const paid = payment?.status === "PAID" ? payment.amount : 0;
  const currency = (payment?.currency ?? booking.price!.currency).toUpperCase();
  if (currency !== "EUR") return "Zahlung in anderer Währung";
  const amount = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(paid / 100);
  const listPrice = booking.price
    ? (booking.price.currency.toUpperCase() === currency ? booking.price.originalAmountMinor : null)
    : (event.ticketPrice != null && event.currency?.toUpperCase() === currency
      ? Math.round(Number(event.ticketPrice.toString()) * 100) * booking.quantity : null);
  if (listPrice === 0 && paid === 0) return `${amount} (kostenlos)`;
  if (listPrice == null || listPrice <= 0) return `${amount} (Listenpreis nicht vergleichbar)`;
  const difference = (paid - listPrice) / listPrice;
  const percentage = new Intl.NumberFormat("de-DE", { style: "percent", maximumFractionDigits: 2, signDisplay: "exceptZero" }).format(difference);
  return `${amount} (${percentage})`;
}
