import "server-only";
import type { VoucherBalance, VoucherCampaign, VoucherCode } from "@prisma/client";
import { VoucherError } from "./errors";

export type VoucherTargets = {
  companyTargets: { companyId: string }[]; eventSeriesTargets: { eventSeriesId: string }[];
  eventTargets: { eventId: string }[]; venueTargets: { venueId: string }[];
};
export type VoucherEvent = {
  id: string; companyId: string; eventSeriesId: string | null; venueId: string | null;
  eventSeries: { companyId: string } | null; venue: { companyId: string } | null;
};

export function voucherTargetMatches(targets: VoucherTargets, event: VoucherEvent) {
  if ((event.eventSeriesId && (!event.eventSeries || event.eventSeries.companyId !== event.companyId)) ||
    (event.venueId && (!event.venue || event.venue.companyId !== event.companyId))) throw new VoucherError("INVALID_CODE");
  // Actual event relations only; an empty selection is false, never platform-wide.
  return targets.companyTargets.some(t => t.companyId === event.companyId) ||
    targets.eventTargets.some(t => t.eventId === event.id) ||
    (event.eventSeriesId !== null && targets.eventSeriesTargets.some(t => t.eventSeriesId === event.eventSeriesId)) ||
    (event.venueId !== null && targets.venueTargets.some(t => t.venueId === event.venueId));
}

export function assertVoucherEligible(campaign: VoucherCampaign & VoucherTargets, code: VoucherCode,
  balance: VoucherBalance | null, event: VoucherEvent, userId: string | null, now: Date) {
  if (campaign.status !== "ACTIVE" || code.status !== "ACTIVE" || code.campaignId !== campaign.id ||
    campaign.currency !== "EUR" || campaign.startsAt > now || (campaign.endsAt && campaign.endsAt <= now) ||
    (code.startsAt && code.startsAt > now) || (code.endsAt && code.endsAt <= now) ||
    (code.startsAt && code.startsAt < campaign.startsAt) ||
    (code.endsAt && campaign.endsAt && code.endsAt > campaign.endsAt) ||
    (code.assignedUserId && code.assignedUserId !== userId) || !voucherTargetMatches(campaign, event)) throw new VoucherError("INVALID_CODE");
  if (campaign.kind === "STORED_VALUE") {
    if (code.mode !== "INDIVIDUAL" || !balance || balance.codeId !== code.id || balance.status !== "ACTIVE" ||
      balance.issuerCompanyId !== event.companyId || balance.currency !== "EUR" ||
      (balance.expiresAt && balance.expiresAt <= now)) throw new VoucherError("INVALID_CODE");
  } else if (balance) { throw new VoucherError("INVALID_CODE"); }
}

