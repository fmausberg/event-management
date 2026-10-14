import "server-only";
import Stripe from "stripe";

export function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe ist nicht konfiguriert.");
  return new Stripe(key, { maxNetworkRetries: 2, timeout: 15_000 });
}

export function paymentOrigin() {
  const url = new URL(process.env.AUTH_URL ?? "http://localhost:3000");
  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:" && url.hostname === "localhost")) {
    throw new Error("AUTH_URL muss HTTPS verwenden.");
  }
  return url.origin;
}

// Start with EUR only; never assume every currency uses two decimal places.
export function euroAmount(price: string, currency: string, quantity: number) {
  if (currency !== "EUR" || !/^\d+\.\d{2}$/.test(price) || !Number.isSafeInteger(quantity) || quantity < 1) throw new Error("Ungültiger Zahlungsbetrag.");
  const amount = Number(price.replace(".", "")) * quantity;
  if (!Number.isSafeInteger(amount) || amount < 50 || amount > 99_999_999) throw new Error("Der Gesamtbetrag muss zwischen 0,50 und 999.999,99 EUR liegen.");
  return amount;
}
