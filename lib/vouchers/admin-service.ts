import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { authorizeVoucherCompany } from "./authorization";
import { VoucherError } from "./errors";
import { voucherTransaction } from "./service";
import { normalizeVoucherCode, voucherCodeDigest, voucherCodeDigests } from "./codes";
import { getVoucherDigestKeyring } from "./config";
import { campaignInput, issueInput, type CampaignInput } from "./admin-validation";

export class VoucherAdminError extends Error {}
export const targetInclude = { companyTargets: true, eventSeriesTargets: true, eventTargets: true, venueTargets: true } as const;
export async function voucherAdminActor() {
  const actor = (await auth())?.user?.id;
  if (!actor) throw new VoucherError("FORBIDDEN");
  return actor;
}
export async function voucherAdminScope(tx: Prisma.TransactionClient, actor: string, slug: string) {
  z.string().min(1).max(191).parse(slug);
  const company = await tx.company.findUnique({ where: { slug }, select: { id: true, name: true, slug: true } });
  if (!company) throw new VoucherError("FORBIDDEN");
  return { ...await authorizeVoucherCompany(tx, actor, company.id), company };
}
type Scope = Awaited<ReturnType<typeof voucherAdminScope>>;
async function campaignForUpdate(tx: Prisma.TransactionClient, id: string, scope: Scope) {
  z.string().min(1).max(191).parse(id);
  await tx.$queryRaw`SELECT "id" FROM "VoucherCampaign" WHERE "id" = ${id} FOR UPDATE`;
  const campaign = await tx.voucherCampaign.findUnique({ where: { id }, include: { ...targetInclude, _count: { select: { codes: true, redemptions: true, balanceUses: true } } } });
  if (!campaign || campaign.ownerCompanyId !== scope.company.id) throw new VoucherError("FORBIDDEN");
  return campaign;
}
export async function validateVoucherTargets(tx: Prisma.TransactionClient, scope: Scope, input: Pick<CampaignInput, "kind" | "companyIds" | "seriesIds" | "eventIds" | "venueIds">) {
  const companyFilter = { companyId: scope.company.id };
  const counts = await Promise.all([
    tx.company.count({ where: { id: { in: input.companyIds }, AND: { id: scope.company.id } } }),
    tx.eventSeries.count({ where: { id: { in: input.seriesIds }, ...companyFilter } }),
    tx.event.count({ where: { id: { in: input.eventIds }, ...companyFilter } }),
    tx.venue.count({ where: { id: { in: input.venueIds }, ...companyFilter } }),
  ]);
  if (counts.some((count, i) => count !== [input.companyIds, input.seriesIds, input.eventIds, input.venueIds][i].length)) throw new VoucherAdminError("Mindestens ein Ziel fehlt oder gehört nicht zum erlaubten Company-Bereich.");
}
function targetIds(c: { companyTargets: { companyId: string }[]; eventSeriesTargets: { eventSeriesId: string }[]; eventTargets: { eventId: string }[]; venueTargets: { venueId: string }[] }) {
  return { companyIds: c.companyTargets.map(v => v.companyId).sort(), seriesIds: c.eventSeriesTargets.map(v => v.eventSeriesId).sort(), eventIds: c.eventTargets.map(v => v.eventId).sort(), venueIds: c.venueTargets.map(v => v.venueId).sort() };
}
export async function saveVoucherCampaign(slug: string, id: string | null, raw: unknown) {
  const input = campaignInput.parse(raw), actor = await voucherAdminActor();
  return voucherTransaction(async tx => {
    const scope = await voucherAdminScope(tx, actor, slug);
    const existing = id ? await campaignForUpdate(tx, id, scope) : null;
    if (existing?.status === "ARCHIVED") throw new VoucherAdminError("Archivierte Kampagnen sind schreibgeschützt.");
    await validateVoucherTargets(tx, scope, input);
    const values = { kind: input.kind, currency: input.currency, percentageBps: input.kind === "PERCENTAGE" ? input.value : null,
      amountMinor: input.kind === "PERCENTAGE" ? null : input.value, startsAt: input.startsAt, endsAt: input.endsAt,
      maxRedemptions: input.maxRedemptions, maxRedemptionsPerCustomer: input.maxRedemptionsPerCustomer,
      maxEligibleTicketsPerBooking: input.maxEligibleTicketsPerBooking, source: input.source };
    const changedRules = existing && (Object.entries(values).some(([key, value]) => JSON.stringify(existing[key as keyof typeof values]) !== JSON.stringify(value)) ||
      JSON.stringify(targetIds(existing)) !== JSON.stringify({ companyIds: input.companyIds, seriesIds: input.seriesIds, eventIds: input.eventIds, venueIds: input.venueIds }));
    if (changedRules && existing && (existing._count.codes || existing._count.redemptions || existing._count.balanceUses)) throw new VoucherAdminError("Nach der ersten Codeausgabe sind Regeln, Quelle und Ziele gesperrt. Bitte eine neue Kampagne anlegen.");
    if (existing?.status === "ACTIVE" && !input.companyIds.length && !input.seriesIds.length && !input.eventIds.length && !input.venueIds.length) throw new VoucherAdminError("Eine aktive Kampagne benötigt mindestens ein Ziel.");
    const priorPolicy = existing?.policy && typeof existing.policy === "object" && !Array.isArray(existing.policy) ? existing.policy : {};
    const data = { ...values, name: input.name, policy: { ...priorPolicy, adminDescription: input.description } };
    const campaign = existing ? await tx.voucherCampaign.update({ where: { id: existing.id }, data: { ...data, ...(changedRules ? { ruleVersion: { increment: 1 } } : {}) } }) :
      await tx.voucherCampaign.create({ data: { ...data, ownerCompanyId: scope.company.id, createdById: actor } });
    if (!existing || changedRules) {
      if (existing) {
        await tx.voucherCampaignCompany.deleteMany({ where: { campaignId: campaign.id } });
        await tx.voucherCampaignEventSeries.deleteMany({ where: { campaignId: campaign.id } });
        await tx.voucherCampaignEvent.deleteMany({ where: { campaignId: campaign.id } });
        await tx.voucherCampaignVenue.deleteMany({ where: { campaignId: campaign.id } });
      }
      await tx.voucherCampaignCompany.createMany({ data: input.companyIds.map(companyId => ({ campaignId: campaign.id, companyId })) });
      await tx.voucherCampaignEventSeries.createMany({ data: input.seriesIds.map(eventSeriesId => ({ campaignId: campaign.id, eventSeriesId })) });
      await tx.voucherCampaignEvent.createMany({ data: input.eventIds.map(eventId => ({ campaignId: campaign.id, eventId })) });
      await tx.voucherCampaignVenue.createMany({ data: input.venueIds.map(venueId => ({ campaignId: campaign.id, venueId })) });
    }
    return campaign.id;
  });
}
export async function changeVoucherCampaignStatus(slug: string, id: string, raw: unknown) {
  const status = z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]).parse(raw), actor = await voucherAdminActor();
  await voucherTransaction(async tx => {
    const scope = await voucherAdminScope(tx, actor, slug), campaign = await campaignForUpdate(tx, id, scope);
    if (campaign.status === "ARCHIVED" && status !== "ARCHIVED") throw new VoucherAdminError("Archivierung kann nicht rückgängig gemacht werden.");
    if (status === "ARCHIVED" && campaign.kind === "STORED_VALUE" && campaign._count.codes) throw new VoucherAdminError("Wertguthaben wurde bereits ausgegeben. Bitte pausieren; eine endgültige Archivierung benötigt eine gesonderte Guthaben-Abschlussregel.");
    if (status === "ACTIVE") {
      const targets = targetIds(campaign);
      if (!Object.values(targets).some(ids => ids.length)) throw new VoucherAdminError("Eine aktive Kampagne benötigt mindestens ein Ziel.");
      await validateVoucherTargets(tx, scope, { ...targets, kind: campaign.kind });
    }
    await tx.voucherCampaign.update({ where: { id }, data: { status } });
  });
}
export async function issueVoucherCodes(slug: string, campaignId: string, raw: unknown) {
  const input = issueInput.parse(raw), actor = await voucherAdminActor();
  return voucherTransaction(async tx => {
    const scope = await voucherAdminScope(tx, actor, slug);
    // One issuance lane across key versions; deterministic IDs additionally make
    // retries safe even when a response is lost. No plaintext is persisted.
    // The lock function returns PostgreSQL `void`. Execute it without asking
    // Prisma to deserialize that unsupported result type.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(190721, 1)`;
    const campaign = await campaignForUpdate(tx, campaignId, scope);
    const batchId = `admin:${scope.company.id}:${input.requestId}`;
    const existing = await tx.voucherCode.findMany({ where: { batchId }, select: { campaignId: true }, take: 1 });
    if (existing.length) {
      if (existing[0].campaignId !== campaignId) throw new VoucherAdminError("Diese Ausgabe-ID wurde bereits verwendet.");
      return { codes: [] as string[], replay: true };
    }
    if (campaign.status === "ARCHIVED") throw new VoucherAdminError("Keine Ausgabe für archivierte Kampagnen.");
    if (!Object.values(targetIds(campaign)).some(ids => ids.length)) throw new VoucherAdminError("Vor der Codeausgabe muss mindestens ein Ziel feststehen.");
    if (campaign.endsAt && campaign.endsAt <= new Date()) throw new VoucherAdminError("Diese Kampagne ist abgelaufen.");
    await validateVoucherTargets(tx, scope, { kind: campaign.kind, ...targetIds(campaign) });
    if (campaign.kind === "STORED_VALUE" && input.mode !== "INDIVIDUAL") throw new VoucherAdminError("Wertguthaben benötigt individuelle Codes.");
    if (campaign.kind !== "STORED_VALUE" && input.expiresAt) throw new VoucherAdminError("Ein Guthaben-Ablaufdatum ist nur für Wertgutscheine vorgesehen.");
    if (input.expiresAt && (input.expiresAt <= new Date() || input.expiresAt <= campaign.startsAt)) throw new VoucherAdminError("Das Guthaben-Ablaufdatum muss in der Zukunft und nach Kampagnenbeginn liegen.");
    if (input.mode === "INDIVIDUAL" && campaign.kind !== "STORED_VALUE" && input.maxRedemptions !== null && input.maxRedemptions !== 1) throw new VoucherAdminError("Individuelle Rabattcodes sind Einmalcodes.");
    if (input.assignedUserId) {
      const recipient = await tx.user.findFirst({ where: { id: input.assignedUserId, ...(!scope.platformAdmin ? { OR: [
        { memberships: { some: { companyId: scope.company.id, status: "ACTIVE" } } }, { bookings: { some: { event: { companyId: scope.company.id } } } },
      ] } : {}) }, select: { id: true } });
      if (!recipient) throw new VoucherAdminError("Der Empfänger ist in diesem Verwaltungsbereich nicht verfügbar.");
    }
    const keyring = getVoucherDigestKeyring();
    const versions = await tx.voucherCode.groupBy({ by: ["digestVersion"] });
    if (versions.some(v => !keyring.keys.some(k => k.version === v.digestVersion))) throw new VoucherAdminError("Codeausgabe gesperrt: Die benötigten Digest-Schlüsselversionen müssen vollständig konfiguriert sein.");
    const codes: string[] = [];
    for (let index = 0; index < input.count; index++) {
      const plaintext = input.mode === "PUBLIC" && input.publicCode ? normalizeVoucherCode(input.publicCode) : `VG-${randomBytes(20).toString("hex").toUpperCase()}`;
      if (plaintext.length < 8) throw new VoucherAdminError("Neue öffentliche Codes benötigen mindestens acht Zeichen; nur vier Endzeichen bleiben sichtbar.");
      if (await tx.voucherCode.count({ where: { OR: voucherCodeDigests(plaintext) } })) throw new VoucherAdminError("Codeausgabe nicht möglich. Bitte einen anderen Code verwenden.");
      const id = `vcode_${createHash("sha256").update(`${batchId}:${index}`).digest("hex")}`;
      await tx.voucherCode.create({ data: { id, campaignId, batchId, ...voucherCodeDigest(plaintext), codeSuffix: plaintext.slice(-4),
        mode: input.mode, maxRedemptions: input.maxRedemptions ?? (input.mode === "INDIVIDUAL" && campaign.kind !== "STORED_VALUE" ? 1 : null),
        assignedUserId: input.assignedUserId, source: input.source } });
      if (campaign.kind === "STORED_VALUE") {
        if (!campaign.amountMinor || campaign.currency !== "EUR") throw new VoucherAdminError("Ungültiger Ausgabewert.");
        const balance = await tx.voucherBalance.create({ data: { codeId: id, issuerCompanyId: scope.company.id, currency: "EUR",
          initialAmountMinor: campaign.amountMinor, balanceMinor: campaign.amountMinor, reservedMinor: 0,
          expiresAt: input.expiresAt, issuanceSource: "ADMIN", issuanceReference: batchId } });
        await tx.voucherBalanceEntry.create({ data: { balanceId: balance.id, type: "ISSUE", operationKey: `voucher:issue:${id}`,
          amountMinor: campaign.amountMinor, balanceDeltaMinor: campaign.amountMinor, reservedDeltaMinor: 0,
          currency: "EUR", createdById: actor, reason: "Administrative issuance; no sale" } });
      }
      codes.push(plaintext);
    }
    return { codes, replay: false };
  });
}
export async function changeVoucherCodeStatus(slug: string, campaignId: string, codeId: string, raw: unknown) {
  const status = z.enum(["ACTIVE", "DISABLED", "ARCHIVED"]).parse(raw), actor = await voucherAdminActor();
  z.string().min(1).max(191).parse(codeId);
  await voucherTransaction(async tx => {
    const scope = await voucherAdminScope(tx, actor, slug);
    const campaign = await campaignForUpdate(tx, campaignId, scope);
    const code = await tx.voucherCode.findFirst({ where: { id: codeId, campaignId }, select: { status: true } });
    if (!code) throw new VoucherError("FORBIDDEN");
    if (status === "ARCHIVED" && campaign.kind === "STORED_VALUE") throw new VoucherAdminError("Wertgutscheincodes bitte reversibel sperren; die endgültige Archivierung ist noch nicht freigegeben.");
    if ((code.status === "ARCHIVED" || campaign.status === "ARCHIVED") && status !== "ARCHIVED") throw new VoucherAdminError("Archivierte Codes oder Kampagnen können nicht reaktiviert werden.");
    if (status === "ACTIVE") await validateVoucherTargets(tx, scope, { kind: campaign.kind, ...targetIds(campaign) });
    await tx.voucherCode.update({ where: { id: codeId }, data: { status } });
  });
}
