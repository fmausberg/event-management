import { beforeEach, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { bookingTaxSnapshot, resolveTax, parseTaxRate, taxOverrideFromForm } from "@/lib/taxes/service";
import { isCountryCode } from "@/lib/taxes/countries";
vi.mock("server-only", () => ({}));
const rule = vi.fn(), event = vi.fn();
const tx = { companyTaxRule: { findUnique: rule }, event: { findUniqueOrThrow: event } } as unknown as Prisma.TransactionClient;
const venue = { companyId: "a", countryCode: "AT" };
beforeEach(() => { rule.mockResolvedValue({ rate: new Prisma.Decimal(20) }); event.mockResolvedValue({ companyId: "a", taxRateOverride: null, venue, eventSeries: null }); });
it.each(["0", "100", "19,1250", "0.0001"])("accepts explicit valid rate %s", rate => expect(parseTaxRate(rate).gte(0)).toBe(true));
it.each(["", "-1", "100.0001", "1.23456", "NaN", "1e1", "19%"])("rejects invalid rate %s", rate => expect(() => parseTaxRate(rate)).toThrow());
it("validates real ISO codes", () => { expect(isCountryCode("DE")).toBe(true); expect(isCountryCode("ZZ")).toBe(false); });
it("uses the actual event venue country and honors zero overrides", async () => {
 expect(await resolveTax(tx, "a", new Prisma.Decimal(0), venue, { companyId: "a", taxRateOverride: new Prisma.Decimal(19) })).toMatchObject({ countryCode: "AT", source: "EVENT_OVERRIDE" });
 expect(rule).not.toHaveBeenCalled();
 expect((await resolveTax(tx, "a", null, venue, { companyId: "a", taxRateOverride: new Prisma.Decimal(0) })).rate.toString()).toBe("0");
 expect((await resolveTax(tx, "a", null, venue, null)).source).toBe("COMPANY_COUNTRY_RULE");
 expect(rule).toHaveBeenCalledWith({ where: { companyId_countryCode: { companyId: "a", countryCode: "AT" } } });
});
it("blocks cross-company associations even with explicit overrides", async () => {
 await expect(resolveTax(tx, "a", new Prisma.Decimal(0), { ...venue, companyId: "b" }, null)).rejects.toThrow();
 await expect(resolveTax(tx, "a", null, venue, { companyId: "b", taxRateOverride: new Prisma.Decimal(19) })).rejects.toThrow();
});
it("never falls back to an invented rate", async () => {
 rule.mockResolvedValue(null);
 await expect(resolveTax(tx, "a", null, venue, null)).rejects.toThrow();
 await expect(resolveTax(tx, "a", new Prisma.Decimal(0), null, null)).rejects.toThrow();
});
it.each([[11900,"19",1900,10000], [10700,"7",700,10000], [3,"20",1,2], [0,"19",0,0], [1999,"0",0,1999]])("rounds gross %s at %s with HALF_UP", async (gross, rate, tax, net) => {
 event.mockResolvedValue({ companyId: "a", taxRateOverride: new Prisma.Decimal(rate), venue, eventSeries: null });
 expect(await bookingTaxSnapshot(tx, "event", gross)).toMatchObject({ taxGrossMinor: gross, taxMinor: tax, taxNetMinor: net, taxCalculationVersion: 1 });
});
it("preserves automatic null and explicit zero", () => {
 const form = new FormData(); form.set("taxMode", "override"); form.set("taxRate", "0");
 expect(taxOverrideFromForm(form)?.toString()).toBe("0");
 form.set("taxMode", "automatic"); expect(taxOverrideFromForm(form)).toBeNull();
 form.append("taxMode", "override"); expect(() => taxOverrideFromForm(form)).toThrow();
});
