import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { VoucherCampaign, VoucherCode } from "@prisma/client";
import { calculateVoucherPrice, type PriceRule } from "@/lib/vouchers/pricing";
import { normalizeVoucherCode, voucherCodeDigest, voucherCodeDigests } from "@/lib/vouchers/codes";
import { assertVoucherEligible, voucherTargetMatches, type VoucherTargets } from "@/lib/vouchers/eligibility";
import { voucherFailure } from "@/lib/vouchers/errors";

vi.mock("server-only", () => ({}));
const rule: PriceRule = { kind: "PERCENTAGE", percentageBps: 2000, amountMinor: null, maxEligibleTicketsPerBooking: null };
const targets: VoucherTargets = { companyTargets: [], eventSeriesTargets: [], eventTargets: [], venueTargets: [] };
const event = { id: "event", companyId: "company", eventSeriesId: "series", venueId: "venue",
  eventSeries: { companyId: "company" }, venue: { companyId: "company" } };
const now = new Date("2026-10-29T12:00:00Z");
beforeEach(() => vi.stubEnv("VOUCHER_CODE_DIGEST_KEYS", JSON.stringify({ active: 2,
  keys: { 1: Buffer.alloc(32, 1).toString("base64"), 2: Buffer.alloc(32, 2).toString("base64") } })));
afterEach(() => vi.unstubAllEnvs());

it("normalizes ASCII codes, preserves separators and supports retained digest keys", () => {
  expect(normalizeVoucherCode(" lea_Rabatt_20 ")).toBe("LEA_RABATT_20");
  expect(voucherCodeDigests(" lea_Rabatt_20 ")).toEqual(voucherCodeDigests("LEA_RABATT_20"));
  expect(voucherCodeDigests("LEA_RABATT_20")).toHaveLength(2);
  expect(voucherCodeDigest("LEA_RABATT_20")).toMatchObject({ digestVersion: 2, codeDigest: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(voucherCodeDigest("AB-CD")).not.toEqual(voucherCodeDigest("AB_CD"));
});
it.each(["", "abc", "FOO BAR", "KODE", "a".repeat(161)])("rejects invalid code syntax without reflecting input", code => {
  expect(() => normalizeVoucherCode(code)).toThrow("Dieser Gutschein");
});
it("fails closed on missing or noncanonical key configuration", () => {
  vi.stubEnv("VOUCHER_CODE_DIGEST_KEYS", '{"active":1,"keys":{"1":"secret"}}');
  expect(() => voucherCodeDigests("SECRET_CODE")).toThrow("derzeit nicht verfügbar");
  expect(voucherFailure(new Error("SECRET_CODE: database details"))).toEqual({ ok: false,
    error: { code: "UNAVAILABLE", message: "Die Gutscheinprüfung ist derzeit nicht verfügbar. Bitte versuche es erneut." } });
});
it("rounds a percentage once on the eligible total", () => {
  expect(calculateVoucherPrice("9.99", "EUR", 3, rule)).toMatchObject({ originalAmountMinor: 2997, discountAmountMinor: 599, payableAmountMinor: 2398 });
  expect(calculateVoucherPrice("1.05", "EUR", 1, { ...rule, percentageBps: 1000 }).discountAmountMinor).toBe(11);
});
it("defaults 100 percent to one ticket and respects an explicit ticket limit", () => {
  const free = { ...rule, percentageBps: 10000 };
  expect(calculateVoucherPrice("20.00", "EUR", 3, free)).toMatchObject({ discountAmountMinor: 2000, payableAmountMinor: 4000 });
  expect(calculateVoucherPrice("20.00", "EUR", 3, { ...free, maxEligibleTicketsPerBooking: 2 }).payableAmountMinor).toBe(2000);
  expect(calculateVoucherPrice("20.00", "EUR", 1, free).requiresCheckout).toBe(false);
});
it("applies fixed discounts once, capped at the eligible subtotal", () => {
  const fixed: PriceRule = { ...rule, kind: "FIXED_AMOUNT", percentageBps: null, amountMinor: 1000 };
  expect(calculateVoucherPrice("8.00", "EUR", 3, fixed).discountAmountMinor).toBe(1000);
  expect(calculateVoucherPrice("8.00", "EUR", 3, { ...fixed, maxEligibleTicketsPerBooking: 1 })).toMatchObject({ discountAmountMinor: 800, payableAmountMinor: 1600 });
});
it("uses only the required stored value and rejects sub-minimum remainder without reducing the use", () => {
  const stored: PriceRule = { ...rule, kind: "STORED_VALUE", percentageBps: null, amountMinor: 5000 };
  expect(calculateVoucherPrice("18.00", "EUR", 1, stored, 5000)).toMatchObject({ voucherAmountMinor: 1800, discountAmountMinor: 0, payableAmountMinor: 0 });
  expect(() => calculateVoucherPrice("10.00", "EUR", 1, stored, 980)).toThrow("mindestens 0,50");
  expect(calculateVoucherPrice("10.00", "EUR", 1, stored, 950).payableAmountMinor).toBe(50);
  expect(() => calculateVoucherPrice("10.00", "EUR", 1, stored, 0)).toThrow("kein Guthaben");
});
it("rejects invalid currency, fractional quantities, overflow and zero-effect codes", () => {
  expect(() => calculateVoucherPrice("1.00", "USD", 1, rule)).toThrow();
  expect(() => calculateVoucherPrice("1.00", "EUR", 1.5, rule)).toThrow();
  expect(() => calculateVoucherPrice("99999999.99", "EUR", 100, rule)).toThrow();
  expect(() => calculateVoucherPrice("0.00", "EUR", 1, rule)).toThrow("reduziert");
});
it("uses OR targets; empty, missing and suggested relations never become platform-wide", () => {
  expect(voucherTargetMatches(targets, event)).toBe(false);
  for (const selected of [ { companyTargets: [{ companyId: "company" }] }, { eventTargets: [{ eventId: "event" }] },
    { eventSeriesTargets: [{ eventSeriesId: "series" }] }, { venueTargets: [{ venueId: "venue" }] } ]) {
    expect(voucherTargetMatches({ ...targets, ...selected }, event)).toBe(true);
  }
  expect(voucherTargetMatches({ ...targets, venueTargets: [{ venueId: "venue" }] }, { ...event, venueId: null, venue: null })).toBe(false);
  expect(voucherTargetMatches({ ...targets, companyTargets: [{ companyId: "company" }], eventTargets: [{ eventId: "event" }] }, event)).toBe(true);
  expect(() => voucherTargetMatches(targets, { ...event, venue: { companyId: "foreign" } })).toThrow();
});
it("checks inclusive start, exclusive end, recipient and code status", () => {
  const campaign = { id: "campaign", ...targets, companyTargets: [{ companyId: "company" }],
    status: "ACTIVE", currency: "EUR", startsAt: now, endsAt: new Date(now.getTime() + 1), kind: "PERCENTAGE" } as VoucherCampaign & VoucherTargets;
  const code = { id: "code", campaignId: campaign.id, status: "ACTIVE", startsAt: null, endsAt: null, assignedUserId: null } as VoucherCode;
  expect(() => assertVoucherEligible(campaign, code, null, event, null, now)).not.toThrow();
  expect(() => assertVoucherEligible(campaign, code, null, event, null, new Date(now.getTime() + 1))).toThrow();
  expect(() => assertVoucherEligible(campaign, { ...code, assignedUserId: "user" }, null, event, null, now)).toThrow();
  expect(() => assertVoucherEligible(campaign, { ...code, status: "DISABLED" }, null, event, null, now)).toThrow();
});
