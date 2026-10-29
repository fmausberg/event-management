import "server-only";
import { voucherTransaction } from "./service";
import { voucherAdminActor, voucherAdminScope, targetInclude } from "./admin-service";
import { VoucherError } from "./errors";

export async function getVoucherAdministration(slug: string, campaignId?: string, page = 1) {
  if (!Number.isInteger(page) || page < 1 || page > 100000) throw new VoucherError("INVALID_INPUT");
  const actor = await voucherAdminActor();
  return voucherTransaction(async tx => {
    const scope = await voucherAdminScope(tx, actor, slug);
    const companyFilter = scope.platformAdmin ? {} : { companyId: scope.company.id };
    const [companies, series, events, venues, campaigns] = await Promise.all([
      tx.company.findMany({ where: scope.platformAdmin ? {} : { id: scope.company.id }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      tx.eventSeries.findMany({ where: companyFilter, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      tx.event.findMany({ where: companyFilter, select: { id: true, name: true }, orderBy: [{ beginsAt: "desc" }, { id: "asc" }] }),
      tx.venue.findMany({ where: companyFilter, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      tx.voucherCampaign.findMany({ where: { ownerCompanyId: scope.company.id, ...(campaignId ? { id: campaignId } : {}) },
        include: { ...targetInclude, _count: { select: { codes: true, redemptions: true, balanceUses: true } } }, orderBy: { createdAt: "desc" } }),
    ]);
    if (campaignId && !campaigns.length) throw new VoucherError("FORBIDDEN");
    const rows = await Promise.all(campaigns.map(async campaign => {
      const [discounts, uses, balances, journal, available] = await Promise.all([
        tx.voucherRedemption.groupBy({ by: ["status", "limitReturnedAt"], where: { campaignId: campaign.id }, _count: { _all: true }, _sum: { discountAmountMinor: true } }),
        tx.voucherBalanceUse.groupBy({ by: ["status"], where: { campaignId: campaign.id }, _count: { _all: true }, _sum: { amountMinor: true, restoredMinor: true } }),
        tx.voucherBalance.aggregate({ where: { code: { campaignId: campaign.id } }, _sum: { balanceMinor: true, reservedMinor: true } }),
        tx.voucherBalanceEntry.groupBy({ by: ["type"], where: { balance: { code: { campaignId: campaign.id } } }, _sum: { amountMinor: true } }),
        tx.voucherBalance.aggregate({ where: { code: { campaignId: campaign.id, status: "ACTIVE", AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: new Date() } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] },
        ] }, status: "ACTIVE",
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, _sum: { balanceMinor: true, reservedMinor: true } }),
      ]);
      const counted = discounts.filter(v => ["RESERVED", "COMMITTED"].includes(v.status) || v.status === "REVERSED" && !v.limitReturnedAt).reduce((n, v) => n + v._count._all, 0) +
        uses.filter(v => ["RESERVED", "COMMITTED", "PARTIALLY_REVERSED"].includes(v.status)).reduce((n, v) => n + v._count._all, 0);
      const count = (status: string) => [...discounts, ...uses].filter(v => v.status === status).reduce((n, v) => n + v._count._all, 0);
      return { campaign, stats: { reserved: count("RESERVED"), committed: count("COMMITTED"), reversed: count("REVERSED"), released: count("RELEASED"),
        remaining: campaign.maxRedemptions === null ? null : Math.max(0, campaign.maxRedemptions - counted),
        discountMinor: discounts.filter(v => v.status === "COMMITTED").reduce((n, v) => n + (v._sum.discountAmountMinor ?? 0), 0),
        balanceMinor: balances._sum.balanceMinor ?? 0, reservedMinor: balances._sum.reservedMinor ?? 0,
        availableMinor: campaign.status === "ACTIVE" && campaign.startsAt <= new Date() && (!campaign.endsAt || campaign.endsAt > new Date()) ? (available._sum.balanceMinor ?? 0) - (available._sum.reservedMinor ?? 0) : 0,
        issuedMinor: journal.find(v => v.type === "ISSUE")?._sum.amountMinor ?? 0,
        spentMinor: journal.find(v => v.type === "SPEND")?._sum.amountMinor ?? 0,
        restoredMinor: journal.find(v => v.type === "RESTORE")?._sum.amountMinor ?? 0 } };
    }));
    const bookingScope = scope.platformAdmin ? {} : { booking: { event: { companyId: scope.company.id } } };
    const [codes, redemptions, uses] = campaignId ? await Promise.all([
      tx.voucherCode.findMany({ where: { campaignId }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 50, skip: (page - 1) * 50,
        select: { id: true, codeSuffix: true, mode: true, status: true, maxRedemptions: true, assignedUserId: true, source: true, batchId: true, createdAt: true,
          balance: { select: { initialAmountMinor: true, balanceMinor: true, reservedMinor: true, expiresAt: true, status: true } } } }),
      tx.voucherRedemption.findMany({ where: { campaignId, ...bookingScope }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 50, skip: (page - 1) * 50,
        select: { id: true, status: true, discountAmountMinor: true, createdAt: true, sourceSnapshot: true, code: { select: { id: true, codeSuffix: true } }, booking: { select: { number: true } } } }),
      tx.voucherBalanceUse.findMany({ where: { campaignId, ...bookingScope }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 50, skip: (page - 1) * 50,
        select: { id: true, status: true, amountMinor: true, restoredMinor: true, createdAt: true, sourceSnapshot: true, code: { select: { id: true, codeSuffix: true } }, booking: { select: { number: true } } } }),
    ]) : [[], [], []];
    const activeCodes = campaignId ? await tx.voucherCode.count({ where: { campaignId, status: "ACTIVE" } }) : 0;
    return { company: scope.company, platformAdmin: scope.platformAdmin, options: { companies, series, events, venues }, rows, codes, redemptions, uses, activeCodes, page };
  });
}
export type VoucherAdministration = Awaited<ReturnType<typeof getVoucherAdministration>>;
