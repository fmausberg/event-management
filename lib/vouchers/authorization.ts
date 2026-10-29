import "server-only";
import { auth } from "@/auth";
import { getPrisma } from "@/lib/db/prisma";
import { VoucherError } from "./errors";
import type { Prisma } from "@prisma/client";

export async function authorizeVoucherCompany(tx: Prisma.TransactionClient, actorId: string, companyId: string) {
  const user = await tx.user.findUnique({ where: { id: actorId }, select: { role: true } });
  if (!user) throw new VoucherError("FORBIDDEN");
  if (user.role !== "ADMIN") {
    const membership = await tx.companyMembership.findUnique({ where: { companyId_userId: { companyId, userId: actorId } } });
    if (membership?.status !== "ACTIVE" || !["COMPANY_ADMIN", "COMPANY_USER"].includes(membership.role)) throw new VoucherError("FORBIDDEN");
  }
  return { actorId, companyId, platformAdmin: user.role === "ADMIN" };
}

/** Server-side gate for future management entry points; does not mutate campaigns. */
export async function requireVoucherCampaignAdmin(campaignId: string) {
  const actor = (await auth())?.user?.id;
  if (!actor || typeof campaignId !== "string" || !campaignId || campaignId.length > 191) throw new VoucherError("FORBIDDEN");
  const db = getPrisma();
  const campaign = await db.voucherCampaign.findUnique({ where: { id: campaignId }, select: { id: true, ownerCompanyId: true } });
  if (!campaign) throw new VoucherError("FORBIDDEN");
  return { ...await authorizeVoucherCompany(db, actor, campaign.ownerCompanyId), campaignId: campaign.id };
}
