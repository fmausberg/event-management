import { beforeEach, expect, it, vi } from "vitest";
import { getVoucherAdministration } from "@/lib/vouchers/admin-data";

const { db } = vi.hoisted(() => ({ db: {
  $transaction: vi.fn(), user: { findUnique: vi.fn() }, companyMembership: { findUnique: vi.fn() },
  company: { findUnique: vi.fn(), findMany: vi.fn() }, eventSeries: { findMany: vi.fn() }, event: { findMany: vi.fn() }, venue: { findMany: vi.fn() },
  voucherCampaign: { findMany: vi.fn() }, voucherCode: { findMany: vi.fn(), count: vi.fn() },
  voucherRedemption: { groupBy: vi.fn(), findMany: vi.fn() }, voucherBalanceUse: { groupBy: vi.fn(), findMany: vi.fn() },
  voucherBalance: { aggregate: vi.fn() }, voucherBalanceEntry: { groupBy: vi.fn() },
} }));
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "actor" } }) }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
beforeEach(() => {
  vi.resetAllMocks(); db.$transaction.mockImplementation(async work => work(db));
  db.user.findUnique.mockResolvedValue({ role: "USER" }); db.companyMembership.findUnique.mockResolvedValue({ role: "COMPANY_ADMIN", status: "ACTIVE" });
  db.company.findUnique.mockResolvedValue({ id: "company", slug: "studio", name: "Studio" });
  for (const table of [db.company, db.eventSeries, db.event, db.venue, db.voucherCode, db.voucherRedemption, db.voucherBalanceUse]) table.findMany.mockResolvedValue([]);
  db.voucherCampaign.findMany.mockResolvedValue([{ id: "campaign", maxRedemptions: 10, status: "ACTIVE", startsAt: new Date(0), endsAt: null }]);
  db.voucherRedemption.groupBy.mockResolvedValue([
    { status: "RESERVED", limitReturnedAt: null, _count: { _all: 2 }, _sum: { discountAmountMinor: 1000 } },
    { status: "COMMITTED", limitReturnedAt: null, _count: { _all: 3 }, _sum: { discountAmountMinor: 1500 } },
    { status: "REVERSED", limitReturnedAt: new Date(), _count: { _all: 2 }, _sum: { discountAmountMinor: 1000 } },
  ]);
  db.voucherBalanceUse.groupBy.mockResolvedValue([]);
  db.voucherBalance.aggregate.mockResolvedValue({ _sum: { balanceMinor: 5000, reservedMinor: 1000 } });
  db.voucherBalanceEntry.groupBy.mockResolvedValue([{ type: "ISSUE", _sum: { amountMinor: 6000 } }, { type: "SPEND", _sum: { amountMinor: 2000 } }, { type: "RESTORE", _sum: { amountMinor: 1000 } }]);
  db.voucherCode.count.mockResolvedValue(4);
});
it("aggregates limits and journal server-side while scoping booking references to the company", async () => {
  const data = await getVoucherAdministration("studio", "campaign", 2);
  expect(data.rows[0].stats).toMatchObject({ reserved: 2, committed: 3, reversed: 2, remaining: 5, discountMinor: 1500, availableMinor: 4000, issuedMinor: 6000, spentMinor: 2000, restoredMinor: 1000 });
  expect(db.voucherRedemption.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { campaignId: "campaign", booking: { event: { companyId: "company" } } }, take: 50, skip: 50 }));
  expect(db.voucherBalanceUse.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { campaignId: "campaign", booking: { event: { companyId: "company" } } } }));
  const selection = JSON.stringify(db.voucherCode.findMany.mock.calls[0][0].select);
  expect(selection).not.toMatch(/codeDigest|digestVersion|email|encrypted/);
});
it("denies ordinary company users before any financial history is read", async () => {
  db.companyMembership.findUnique.mockResolvedValue({ role: "COMPANY_USER", status: "ACTIVE" });
  await expect(getVoucherAdministration("studio")).rejects.toThrow();
  expect(db.voucherCampaign.findMany).not.toHaveBeenCalled();
});
it("allows platform administrators to inspect cross-company campaign bookings", async () => {
  db.user.findUnique.mockResolvedValue({ role: "ADMIN" });
  await getVoucherAdministration("studio", "campaign");
  expect(db.voucherRedemption.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { campaignId: "campaign" } }));
});
it("does not disclose a foreign campaign through its ID", async () => {
  db.voucherCampaign.findMany.mockResolvedValue([]);
  await expect(getVoucherAdministration("studio", "foreign")).rejects.toThrow();
  expect(db.voucherCode.findMany).not.toHaveBeenCalled();
  expect(db.voucherCampaign.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerCompanyId: "company", id: "foreign" } }));
});
