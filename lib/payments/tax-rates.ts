import "server-only";
import { createHash } from "node:crypto";
import type { Payment, Prisma } from "@prisma/client";
import type Stripe from "stripe";
import { getPrisma } from "@/lib/db/prisma";
import { getStripe } from "./stripe";

async function manualTaxRate(stripeAccountId: string, countryCode: string, rate: Prisma.Decimal) {
 const db = getPrisma(), stripe = getStripe(), displayName = "MwSt.";
 const identity = { stripeAccountId, countryCode, rate, displayName };
 const where = { stripeAccountId_countryCode_rate_displayName: identity };
 const cached = await db.stripeTaxRateCache.findUnique({ where });
 if (cached) return cached.stripeTaxRateId;
 const key = createHash("sha256").update(`${stripeAccountId}:${countryCode}:${rate.toFixed(4)}:${displayName}:inclusive:v1`).digest("hex");
 // Recover rates even after Stripe prunes its 24-hour idempotency cache.
 let stripeTaxRateId: string | undefined;
 for await (const existing of stripe.taxRates.list({ active: true, inclusive: true, limit: 100 }, { stripeAccount: stripeAccountId })) {
  if (existing.metadata.pilotTaxKey === key && existing.country === countryCode && existing.display_name === displayName && rate.eq(String(existing.percentage))) { stripeTaxRateId = existing.id; break; }
 }
 if (!stripeTaxRateId) {
  const created = await stripe.taxRates.create({ country: countryCode, percentage: rate.toNumber(), inclusive: true,
   display_name: displayName, metadata: { pilotTaxKey: key } }, { stripeAccount: stripeAccountId, idempotencyKey: `pilot-tax-${key}` });
  stripeTaxRateId = created.id;
 }
 const stored = await db.stripeTaxRateCache.upsert({ where, create: { ...identity, stripeTaxRateId }, update: {} });
 return stored.stripeTaxRateId;
}

/** No Stripe call is made in a DB transaction. CAS freezes one complete request before checkout. */
export async function prepareTaxCheckout(payment: Payment): Promise<Payment> {
 const db = getPrisma();
 const request = payment.checkoutRequest as Prisma.JsonObject;
 const metadata = request.metadata as Prisma.JsonObject | undefined;
 if (metadata?.pilotTaxStatus !== "pending") return payment; // Includes untouched legacy requests.
 if (payment.checkoutSessionId) throw new Error("Tax checkout state requires reconciliation");
 const snapshot = await db.bookingPrice.findUniqueOrThrow({ where: { bookingId: payment.bookingId } });
 if (snapshot.taxRate == null || !snapshot.taxCountryCode || snapshot.taxCalculationVersion !== 1 || snapshot.payableAmountMinor !== payment.amount) throw new Error("Tax snapshot unavailable");
 let taxRateId: string;
 try { taxRateId = await manualTaxRate(payment.stripeAccountId, snapshot.taxCountryCode, snapshot.taxRate); }
 catch {
  console.error("[payments:tax] Connected-account TaxRate unavailable");
  throw new Error("Checkout tax configuration unavailable");
 }
 const params = request as unknown as Stripe.Checkout.SessionCreateParams;
 if (params.line_items?.length !== 1 || params.line_items[0].quantity !== 1 || params.line_items[0].price_data?.unit_amount !== payment.amount) throw new Error("Unexpected tax checkout positions");
 const frozen = { ...params, metadata: { ...params.metadata, pilotTaxStatus: "frozen", pilotTaxMinor: String(snapshot.taxMinor) },
  line_items: params.line_items.map(line => ({ ...line, tax_rates: [taxRateId], price_data: { ...line.price_data!, tax_behavior: "inclusive" as const } })) };
 await db.payment.updateMany({ where: { id: payment.id, checkoutSessionId: null, checkoutRequest: { equals: request } }, data: { checkoutRequest: frozen as unknown as Prisma.InputJsonValue } });
 const current = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
 if ((current.checkoutRequest as { metadata?: { pilotTaxStatus?: string } }).metadata?.pilotTaxStatus !== "frozen") throw new Error("Tax request changed concurrently");
 return current;
}

/** Fail closed before exposing a session whose inclusive tax differs from the snapshot. */
export function assertCheckoutTax(session: Stripe.Checkout.Session, payment: Payment) {
 const metadata = (payment.checkoutRequest as { metadata?: { pilotTaxStatus?: string; pilotTaxMinor?: string } }).metadata;
 if (metadata?.pilotTaxStatus !== "frozen" || session.status === "expired") return;
 const expected = Number(metadata.pilotTaxMinor);
 if (!Number.isSafeInteger(expected) || expected < 0 || session.amount_total !== payment.amount || session.total_details?.amount_tax !== expected) {
  console.error("[payments:tax] Checkout tax total mismatch; reconciliation required");
  throw new Error("Checkout tax mismatch");
 }
}
