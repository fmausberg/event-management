import { beforeEach, expect, it, vi } from "vitest";
import { Prisma, type Payment } from "@prisma/client";
import { prepareTaxCheckout, assertCheckoutTax } from "@/lib/payments/tax-rates";
vi.mock("server-only", () => ({}));
const { db, stripe } = vi.hoisted(() => ({ db: {
 bookingPrice: { findUniqueOrThrow: vi.fn() }, stripeTaxRateCache: { findUnique: vi.fn(), upsert: vi.fn() },
 payment: { updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
}, stripe: { taxRates: { list: vi.fn(), create: vi.fn() } } }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("@/lib/payments/stripe", () => ({ getStripe: () => stripe }));
let payment: Payment;
beforeEach(() => {
 vi.resetAllMocks();
 payment = { id: "payment", bookingId: "booking", stripeAccountId: "acct_direct", amount: 1190, checkoutSessionId: null,
  checkoutRequest: { mode: "payment", metadata: { pilotTaxStatus: "pending" }, line_items: [{ price_data: { currency: "eur", unit_amount: 1190, product_data: { name: "Event" } }, quantity: 1 }] },
 } as unknown as Payment;
 db.bookingPrice.findUniqueOrThrow.mockResolvedValue({ taxCountryCode: "DE", taxRate: new Prisma.Decimal(19), taxMinor: 190, taxCalculationVersion: 1, payableAmountMinor: 1190 });
 db.stripeTaxRateCache.findUnique.mockResolvedValue(null);
 stripe.taxRates.list.mockReturnValue((async function* () {})());
 stripe.taxRates.create.mockResolvedValue({ id: "txr_19" });
 db.stripeTaxRateCache.upsert.mockImplementation(async ({ create }) => create);
 db.payment.updateMany.mockImplementation(async ({ data }) => { payment = { ...payment, ...data }; return { count: 1 }; });
 db.payment.findUniqueOrThrow.mockImplementation(async () => payment);
});
it("freezes an inclusive connected-account tax rate before checkout", async () => {
 const current = await prepareTaxCheckout(payment);
 expect(stripe.taxRates.create).toHaveBeenCalledWith(expect.objectContaining({ country: "DE", percentage: 19, inclusive: true }), expect.objectContaining({ stripeAccount: "acct_direct", idempotencyKey: expect.stringMatching(/^pilot-tax-/) }));
 expect(current.checkoutRequest).toMatchObject({ metadata: { pilotTaxStatus: "frozen", pilotTaxMinor: "190" }, line_items: [{ tax_rates: ["txr_19"], quantity: 1, price_data: { unit_amount: 1190, tax_behavior: "inclusive" } }] });
 expect(db.payment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ checkoutSessionId: null, checkoutRequest: { equals: expect.objectContaining({ metadata: { pilotTaxStatus: "pending" } }) } }) }));
});
it("transmits explicit zero as a TaxRate instead of dropping it", async () => {
 db.bookingPrice.findUniqueOrThrow.mockResolvedValue({ taxCountryCode: "AT", taxRate: new Prisma.Decimal(0), taxMinor: 0, taxCalculationVersion: 1, payableAmountMinor: 1190 });
 await prepareTaxCheckout(payment);
 expect(stripe.taxRates.create).toHaveBeenCalledWith(expect.objectContaining({ percentage: 0, inclusive: true }), expect.anything());
});
it("reuses frozen parameters without reading changed company rules or calling Stripe", async () => {
 payment.checkoutRequest = { metadata: { pilotTaxStatus: "frozen" }, line_items: [{ tax_rates: ["txr_old"] }] };
 expect(await prepareTaxCheckout(payment)).toBe(payment);
 expect(db.bookingPrice.findUniqueOrThrow).not.toHaveBeenCalled(); expect(stripe.taxRates.create).not.toHaveBeenCalled();
});
it("keeps legacy checkout requests untouched", async () => {
 payment.checkoutRequest = { metadata: { bookingPriceVersion: "1" } };
 expect(await prepareTaxCheckout(payment)).toBe(payment);
 expect(db.payment.updateMany).not.toHaveBeenCalled();
});
it("uses the persistent account-scoped cache", async () => {
 db.stripeTaxRateCache.findUnique.mockResolvedValue({ stripeTaxRateId: "txr_cached" });
 const result = await prepareTaxCheckout(payment);
 expect(result.checkoutRequest).toMatchObject({ line_items: [{ tax_rates: ["txr_cached"] }] });
 expect(stripe.taxRates.list).not.toHaveBeenCalled();
});
it("does not freeze a taxless request when Stripe fails", async () => {
 const log = vi.spyOn(console, "error").mockImplementation(() => {});
 stripe.taxRates.create.mockRejectedValue(new Error("Stripe unavailable"));
 await expect(prepareTaxCheckout(payment)).rejects.toThrow();
 expect(db.payment.updateMany).not.toHaveBeenCalled();
 expect(log).toHaveBeenCalledWith("[payments:tax] Connected-account TaxRate unavailable");
 log.mockRestore();
});
it("refuses payments whose snapshot does not match", async () => {
 payment.amount = 1200;
 await expect(prepareTaxCheckout(payment)).rejects.toThrow("Tax snapshot unavailable");
 expect(stripe.taxRates.create).not.toHaveBeenCalled();
});

it("verifies the Stripe tax total, including explicit zero", async () => {
 const current = await prepareTaxCheckout(payment);
 expect(() => assertCheckoutTax({ status: "open", amount_total: 1190, total_details: { amount_tax: 190 } } as never, current)).not.toThrow();
 const log = vi.spyOn(console, "error").mockImplementation(() => {});
 expect(() => assertCheckoutTax({ status: "open", amount_total: 1190, total_details: { amount_tax: 0 } } as never, current)).toThrow("Checkout tax mismatch");
 expect(log).toHaveBeenCalledWith("[payments:tax] Checkout tax total mismatch; reconciliation required");
 log.mockRestore();
});
