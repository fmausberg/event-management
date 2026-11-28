import { beforeEach, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { bookingTaxSnapshot, resolveTax, parseTaxRate, taxOverrideFromForm } from "@/lib/taxes/service";
import { isCountryCode } from "@/lib/taxes/countries";
vi.mock("server-only", () => ({}));
const rule = vi.fn(), event = vi.fn(), company = vi.fn();
const tx = { companyTaxRule: { findUnique: rule }, event: { findUniqueOrThrow: event }, company: { findUniqueOrThrow: company } } as unknown as Prisma.TransactionClient;
const venue = { companyId: "a", countryCode: "AT" };
beforeEach(() => { rule.mockResolvedValue({ rate: new Prisma.Decimal(20) }); event.mockResolvedValue({ companyId: "a", taxRateOverride: null, venue, eventSeries: null }); });
beforeEach(() => { company.mockResolvedValue({ isSmallBusiness: false }); });
it("prioritizes the German small business exemption over event and series rates", async () => {
 company.mockResolvedValue({ isSmallBusiness: true });
 const tax = await resolveTax(tx, "a", new Prisma.Decimal(19), { ...venue, countryCode: "DE" }, { companyId: "a", taxRateOverride: new Prisma.Decimal(7) });
 expect(tax.source).toBe("COMPANY_SMALL_BUSINESS");
 expect(tax.rate.toString()).toBe("0");
});
it("keeps foreign country rules for German small businesses", async () => {
 company.mockResolvedValue({ isSmallBusiness: true });
 const tax = await resolveTax(tx, "a", null, venue, null);
 expect(tax.source).toBe("COMPANY_COUNTRY_RULE");
 expect(tax.rate.toString()).toBe("20");
});
it("uses normal German tax rules when the exemption is disabled", async () => {
 const tax = await resolveTax(tx, "a", new Prisma.Decimal(19), { ...venue, countryCode: "DE" }, null);
 expect(tax.source).toBe("EVENT_OVERRIDE");
 expect(tax.rate.toString()).toBe("19");
});
it("records tax exemption without reducing the ticket price", async () => {
 company.mockResolvedValue({ isSmallBusiness: true });
 event.mockResolvedValue({ companyId: "a", taxRateOverride: new Prisma.Decimal(19), venue: { ...venue, countryCode: "DE" }, eventSeries: null });
 expect(await bookingTaxSnapshot(tx, "event", 11900)).toMatchObject({ taxSource: "COMPANY_SMALL_BUSINESS", taxGrossMinor: 11900, taxMinor: 0, taxNetMinor: 11900 });
});
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
