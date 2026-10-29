import "server-only";
import { VoucherError } from "./errors";

export type VoucherPrice = {
  currency: "EUR"; unitPriceMinor: number; quantity: number; originalAmountMinor: number;
  eligibleQuantity: number; eligibleAmountMinor: number; discountAmountMinor: number;
  voucherAmountMinor: number; payableAmountMinor: number; requiresCheckout: boolean;
};
export type PriceRule = {
  kind: "PERCENTAGE" | "FIXED_AMOUNT" | "STORED_VALUE";
  percentageBps: number | null; amountMinor: number | null; maxEligibleTicketsPerBooking: number | null;
};
const integer = (n: number, min: number, max = 2147483647) => Number.isSafeInteger(n) && n >= min && n <= max;

export function calculateVoucherPrice(price: string, currency: string, quantity: number, rule: PriceRule, availableMinor = 0): VoucherPrice {
  if (currency !== "EUR" || !/^\d{1,8}\.\d{2}$/.test(price) || !integer(quantity, 1, 100)) throw new VoucherError("INVALID_INPUT");
  const unitPriceMinor = Number(price.replace(".", ""));
  const originalAmountMinor = unitPriceMinor * quantity;
  if (!integer(unitPriceMinor, 0) || !integer(originalAmountMinor, 0)) throw new VoucherError("INVALID_INPUT");
  if (rule.maxEligibleTicketsPerBooking !== null && !integer(rule.maxEligibleTicketsPerBooking, 1)) throw new VoucherError("INVALID_CODE");
  const ticketLimit = rule.maxEligibleTicketsPerBooking ?? (rule.kind === "PERCENTAGE" && rule.percentageBps === 10000 ? 1 : quantity);
  const eligibleQuantity = Math.min(quantity, ticketLimit);
  const eligibleAmountMinor = unitPriceMinor * eligibleQuantity;
  let discountAmountMinor = 0, voucherAmountMinor = 0;
  if (rule.kind === "PERCENTAGE") {
    if (rule.percentageBps === null || !integer(rule.percentageBps, 1, 10000) || rule.amountMinor !== null) throw new VoucherError("INVALID_CODE");
    // Product is below 2^53 with the checked Int32 base; round HALF_UP exactly once.
    discountAmountMinor = Math.floor((eligibleAmountMinor * rule.percentageBps + 5000) / 10000);
  } else if (rule.kind === "FIXED_AMOUNT") {
    if (rule.amountMinor === null || !integer(rule.amountMinor, 1) || rule.percentageBps !== null) throw new VoucherError("INVALID_CODE");
    discountAmountMinor = Math.min(eligibleAmountMinor, rule.amountMinor);
  } else if (rule.kind === "STORED_VALUE") {
    if (rule.amountMinor === null || !integer(rule.amountMinor, 1) || rule.percentageBps !== null) throw new VoucherError("INVALID_CODE");
    if (!integer(availableMinor, 0) || availableMinor === 0) throw new VoucherError("NO_BALANCE");
    voucherAmountMinor = Math.min(originalAmountMinor, availableMinor);
  } else { throw new VoucherError("INVALID_CODE"); }
  if (discountAmountMinor + voucherAmountMinor === 0) throw new VoucherError("NO_BENEFIT");
  const payableAmountMinor = originalAmountMinor - discountAmountMinor - voucherAmountMinor;
  if (payableAmountMinor > 0 && payableAmountMinor < 50) throw new VoucherError("MINIMUM_AMOUNT");
  if (payableAmountMinor > 99_999_999) throw new VoucherError("INVALID_INPUT");
  return { currency: "EUR", unitPriceMinor, quantity, originalAmountMinor, eligibleQuantity, eligibleAmountMinor,
    discountAmountMinor, voucherAmountMinor, payableAmountMinor, requiresCheckout: payableAmountMinor > 0 };
}

