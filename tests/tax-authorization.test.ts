import { beforeEach, expect, it, vi } from "vitest";
import { loadTaxEditor, saveTaxConfiguration } from "@/lib/taxes/actions";
import { Prisma } from "@prisma/client";
vi.mock("server-only", () => ({}));
const { admin, access, db } = vi.hoisted(() => ({ admin: vi.fn(), access: vi.fn(), db: {
 $transaction: vi.fn(), companyTaxRule: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn(), findUnique: vi.fn() }, event: { count: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() }, eventSeries: { updateMany: vi.fn() },
} }));
vi.mock("@/lib/companies/members", () => ({ requireCompanyAdmin: admin, requireCompanyAccess: access, MemberAccessError: class extends Error {} }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); admin.mockResolvedValue({ id: "own" }); access.mockResolvedValue({ company: { id: "own" }, canManageMembers: true }); db.$transaction.mockImplementation(async work => work(db)); db.event.findMany.mockResolvedValue([]); db.event.count.mockResolvedValue(0); db.companyTaxRule.findUnique.mockResolvedValue({ rate: new Prisma.Decimal(19) }); });
it("does not query or return tax data to Company Users", async () => {
 access.mockResolvedValue({ company: { id: "own" }, canManageMembers: false });
 expect(await loadTaxEditor("slug", "event", "event", "venue", "series")).toBeNull();
 expect(db.event.findFirst).not.toHaveBeenCalled();
});
it.each(["country", "event", "series"] as const)("rechecks admin access for manipulated %s forms", async kind => {
 admin.mockRejectedValue(new Error("Forbidden"));
 expect((await saveTaxConfiguration("slug", kind, "foreign", {}, new FormData())).success).not.toBe(true);
 expect(db.$transaction).not.toHaveBeenCalled();
});
it("scopes event overrides to the authorized company", async () => {
 db.event.updateMany.mockResolvedValue({ count: 0 });
 const form = new FormData(); form.set("mode", "override"); form.set("rate", "0");
 expect((await saveTaxConfiguration("slug", "event", "foreign", {}, form)).success).not.toBe(true);
 expect(db.event.updateMany).toHaveBeenCalledWith({ where: { id: "foreign", companyId: "own" }, data: { taxRateOverride: new Prisma.Decimal(0) } });
});
it("rejects arbitrary two-letter country codes", async () => {
 const form = new FormData(); form.set("countryCode", "ZZ"); form.set("rate", "19");
 expect((await saveTaxConfiguration("slug", "country", "", {}, form)).success).not.toBe(true);
 expect(db.companyTaxRule.create).not.toHaveBeenCalled();
});
it("persists valid zero country rules without a default", async () => {
 const form = new FormData(); form.set("intent", "add"); form.set("countryCode", "CH"); form.set("rate", "0");
 expect(await saveTaxConfiguration("slug", "country", "", {}, form)).toMatchObject({ success: true });
 expect(db.companyTaxRule.create).toHaveBeenCalledWith({ data: { companyId: "own", countryCode: "CH", rate: new Prisma.Decimal(0) } });
});

function countryForm(intent: string, rate = "20") {
 const form = new FormData(); form.set("intent", intent); form.set("countryCode", "DE"); form.set("rate", rate); return form;
}
it("blocks deletion server-side when upcoming events exist, including overridden events", async () => {
 db.event.count.mockResolvedValueOnce(3).mockResolvedValueOnce(0);
 const result = await saveTaxConfiguration("slug", "country", "", {}, countryForm("remove"));
 expect(result.success).not.toBe(true); expect(result.message).toContain("3");
 expect(db.companyTaxRule.deleteMany).not.toHaveBeenCalled();
 expect(db.event.count).toHaveBeenCalledWith({ where: expect.objectContaining({ companyId: "own", venue: { companyId: "own", countryCode: "DE" }, status: { in: ["DRAFT", "PUBLISHED"] }, beginsAt: { gt: expect.any(Date) } }) });
});
it("allows deletion when there are no upcoming events", async () => {
 expect(await saveTaxConfiguration("slug", "country", "", {}, countryForm("remove"))).toMatchObject({ success: true });
 expect(db.companyTaxRule.deleteMany).toHaveBeenCalledWith({ where: { companyId: "own", countryCode: "DE" } });
});
it("requires confirmation and reports only inheriting events as affected", async () => {
 db.event.count.mockResolvedValueOnce(5).mockResolvedValueOnce(2);
 expect(await saveTaxConfiguration("slug", "country", "", {}, countryForm("update"))).toMatchObject({ confirmation: { rate: "20", upcomingCount: 5, affectedCount: 2 } });
 expect(db.companyTaxRule.update).not.toHaveBeenCalled();
});
it("accepts confirmation only for the currently requested rate and fresh counts", async () => {
 const form = countryForm("update"); form.set("confirmedRate", "20"); form.set("confirmedUpcomingCount", "5"); form.set("confirmedAffectedCount", "2");
 db.event.count.mockResolvedValueOnce(5).mockResolvedValueOnce(2);
 expect(await saveTaxConfiguration("slug", "country", "", {}, form)).toMatchObject({ success: true });
 expect(db.companyTaxRule.update).toHaveBeenCalledOnce();
 db.companyTaxRule.update.mockClear();
 db.event.count.mockResolvedValueOnce(6).mockResolvedValueOnce(3);
 expect(await saveTaxConfiguration("slug", "country", "", {}, form)).toMatchObject({ confirmation: { upcomingCount: 6, affectedCount: 3 } });
 expect(db.companyTaxRule.update).not.toHaveBeenCalled();
});
it("does not warn if the rate is unchanged", async () => {
 expect(await saveTaxConfiguration("slug", "country", "", {}, countryForm("update", "19"))).toMatchObject({ success: true });
 expect(db.event.count).not.toHaveBeenCalled();
});
