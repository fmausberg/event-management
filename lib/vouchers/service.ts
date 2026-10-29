import "server-only";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { getPrisma } from "@/lib/db/prisma";
import { readBookingToken } from "@/lib/bookings/public-token";
import { emailSchema } from "@/lib/auth/validation";
import { voucherCodeDigests } from "./codes";
import { assertVoucherEligible } from "./eligibility";
import { calculateVoucherPrice, type VoucherPrice } from "./pricing";
import { VoucherError, voucherFailure, type VoucherResult } from "./errors";

type Tx = Prisma.TransactionClient;
type Customer = { userId: string | null; guestEmail: string | null };
export type VoucherQuoteInput = { eventId: string; quantity: number; email: string; code: string };
export type VoucherReservationInput = VoucherQuoteInput & { token: string };
export type ReservedVoucher = { bookingId: string; price: VoucherPrice; replay: boolean };
const campaignInclude = { companyTargets: true, eventSeriesTargets: true, eventTargets: true, venueTargets: true } as const;
const codeInclude = { campaign: { include: campaignInclude }, balance: true } as const;
type LoadedCode = Prisma.VoucherCodeGetPayload<{ include: typeof codeInclude }>;
const bookingInclude = { price: true, payment: true, voucherRedemption: true, voucherBalanceUses: true } as const;

function customer(input: VoucherQuoteInput, userId: string | null): Customer {
  if (typeof input.eventId !== "string" || !input.eventId || input.eventId.length > 191 ||
    !Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 100) throw new VoucherError("INVALID_INPUT");
  const email = emailSchema.safeParse(input.email);
  if (!email.success) throw new VoucherError("INVALID_INPUT");
  // A guest email is a soft limit only, NOT a verified person identity.
  return { userId, guestEmail: userId ? null : email.data };
}

async function lookupCode(tx: Tx, code: string): Promise<LoadedCode> {
  const matches = await tx.voucherCode.findMany({ where: { OR: voucherCodeDigests(code) }, include: codeInclude, take: 2 });
  // Includes disabled codes when checking ambiguity across key versions.
  if (matches.length !== 1) throw new VoucherError("INVALID_CODE");
  return matches[0];
}

async function readEvent(tx: Tx, eventId: string, now: Date) {
  const event = await tx.event.findUnique({ where: { id: eventId }, include: {
    eventSeries: { select: { companyId: true } }, venue: { select: { companyId: true } },
  } });
  if (!event || event.status !== "PUBLISHED" || !event.beginsAt || event.beginsAt <= now ||
    !event.ticketPrice || event.currency !== "EUR") throw new VoucherError("INVALID_CODE");
  return event;
}

const countedRedemptions: Prisma.VoucherRedemptionWhereInput = { OR: [
  { status: { in: ["RESERVED", "COMMITTED"] } }, { status: "REVERSED", limitReturnedAt: null },
] };
const countedUses: Prisma.VoucherBalanceUseWhereInput = { status: { in: ["RESERVED", "COMMITTED", "PARTIALLY_REVERSED"] } };

async function checkLimits(tx: Tx, code: LoadedCode, identity: Customer) {
  const campaign = code.campaign;
  const count = async (scope: { campaignId: string; codeId?: string }, perCustomer = false) => {
    // The normalized email is frozen in a snapshot, not read from an editable profile.
    const identityFilter = !perCustomer ? {} : identity.userId ? { userId: identity.userId } : {
      userId: null, ruleSnapshot: { path: ["customer", "guestEmail"], equals: identity.guestEmail! },
    };
    const discounts = await tx.voucherRedemption.count({ where: { ...scope, ...identityFilter, ...countedRedemptions } });
    const balances = await tx.voucherBalanceUse.count({ where: { ...scope, ...identityFilter, ...countedUses } });
    return discounts + balances;
  };
  const codeLimit = code.maxRedemptions ?? (code.mode === "INDIVIDUAL" && campaign.kind !== "STORED_VALUE" ? 1 : null);
  for (const [limit, scope, perCustomer] of [
    [campaign.maxRedemptions, { campaignId: campaign.id }, false],
    [codeLimit, { campaignId: campaign.id, codeId: code.id }, false],
    [campaign.maxRedemptionsPerCustomer, { campaignId: campaign.id }, true],
  ] as const) {
    if (limit !== null && (!Number.isSafeInteger(limit) || limit < 1 || await count(scope, perCustomer) >= limit)) throw new VoucherError("LIMIT_REACHED");
  }
}

async function evaluate(tx: Tx, input: VoucherQuoteInput, identity: Customer, code: LoadedCode, now: Date) {
  const event = await readEvent(tx, input.eventId, now);
  assertVoucherEligible(code.campaign, code, code.balance, event, identity.userId, now);
  await checkLimits(tx, code, identity);
  const price = calculateVoucherPrice(event.ticketPrice!.toFixed(2), event.currency, input.quantity,
    code.campaign, code.balance ? code.balance.balanceMinor - code.balance.reservedMinor : 0);
  return { event, price };
}

export async function voucherTransaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  // Same bounded P2034-only retry policy as lib/cancellations/transaction.ts.
  for (let attempt = 0; ; attempt++) {
    try { return await getPrisma().$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
    catch (error) {
      if (attempt < 3 && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") continue;
      throw error;
    }
  }
}

/** Advisory only: never reserves inventory, limits or money. */
export async function quoteVoucher(input: VoucherQuoteInput): Promise<VoucherResult<VoucherPrice>> {
  try {
    const identity = customer(input, (await auth())?.user?.id ?? null);
    const price = await voucherTransaction(async tx => {
      const code = await lookupCode(tx, input.code);
      return (await evaluate(tx, input, identity, code, new Date())).price;
    });
    return { ok: true, value: price };
  } catch (error) { return voucherFailure(error); }
}

/** Internal only: caller must use a Serializable transaction and a session-derived user ID. */
export async function reserveVoucherInTransaction(tx: Tx, input: VoucherReservationInput, userId: string | null): Promise<ReservedVoucher> {
  const identity = customer(input, userId);
  const token = readBookingToken(input.token);
  if (!token || token.eventId !== input.eventId) throw new VoucherError("BOOKING_CONFLICT");
  // Lock order: booking, campaign, balance. All mutations run inside Serializable.
  await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${token.id} FOR UPDATE`;
  const booking = await tx.booking.findUnique({ where: { id: token.id }, include: bookingInclude });
  if (!booking || booking.platform !== null || booking.eventId !== input.eventId || booking.quantity !== input.quantity ||
    booking.userId !== identity.userId || booking.customerEmail?.trim().toLowerCase() !== input.email.trim().toLowerCase()) throw new VoucherError("BOOKING_CONFLICT");
  const code = await lookupCode(tx, input.code);
  const existing = booking.voucherRedemption ?? booking.voucherBalanceUses[0];
  if (existing) {
    const price = booking.price;
    if ((booking.voucherRedemption && booking.voucherBalanceUses.length) || booking.voucherBalanceUses.length > 1 ||
      existing.codeId !== code.id || existing.requestKey !== `voucher:${booking.id}` || !price ||
      price.eventId !== input.eventId || price.quantity !== input.quantity || price.currency !== token.currency ||
      price.unitPriceMinor !== Number(token.price.replace(".", "")) ||
      !["PENDING_PAYMENT", "CONFIRMED"].includes(booking.status) || !["RESERVED", "COMMITTED"].includes(existing.status)) throw new VoucherError("BOOKING_CONFLICT");
    return { bookingId: booking.id, replay: true, price: {
      currency: "EUR", unitPriceMinor: price.unitPriceMinor, quantity: price.quantity,
      originalAmountMinor: price.originalAmountMinor, discountAmountMinor: price.discountAmountMinor,
      voucherAmountMinor: price.voucherAmountMinor, payableAmountMinor: price.payableAmountMinor,
      eligibleQuantity: booking.voucherRedemption?.eligibleQuantity ?? price.quantity,
      eligibleAmountMinor: booking.voucherRedemption?.eligibleAmountMinor ?? price.originalAmountMinor,
      requiresCheckout: price.payableAmountMinor > 0,
    } };
  }
  const now = new Date();
  // Never retrofit a coupon into an existing checkout or an old confirmed booking.
  if (booking.price || booking.payment || booking.status !== "PENDING_PAYMENT" ||
    !booking.reservedUntil || booking.reservedUntil <= now) throw new VoucherError("BOOKING_CONFLICT");
  await tx.$queryRaw`SELECT "id" FROM "VoucherCampaign" WHERE "id" = ${code.campaignId} FOR UPDATE`;
  if (code.balance) await tx.$queryRaw`SELECT "id" FROM "VoucherBalance" WHERE "id" = ${code.balance.id} FOR UPDATE`;
  // Re-read after locks. Serializable retries discard all stale snapshots on conflict.
  const current = await tx.voucherCode.findUniqueOrThrow({ where: { id: code.id }, include: codeInclude });
  const { event, price } = await evaluate(tx, input, identity, current, now);
  if (event.ticketPrice!.toFixed(2) !== token.price || event.currency !== token.currency) throw new VoucherError("PRICE_CHANGED");
  const { campaign } = current;
  const common = {
    bookingId: booking.id, campaignId: campaign.id, codeId: current.id, userId: identity.userId,
    requestKey: `voucher:${booking.id}`, reservedUntil: booking.reservedUntil, currency: "EUR", ruleVersion: campaign.ruleVersion,
    ruleSnapshot: { version: 1, customer: identity, kind: campaign.kind, percentageBps: campaign.percentageBps,
      amountMinor: campaign.amountMinor, maxEligibleTicketsPerBooking: campaign.maxEligibleTicketsPerBooking,
      maxRedemptions: campaign.maxRedemptions, maxRedemptionsPerCustomer: campaign.maxRedemptionsPerCustomer,
      codeLimit: current.maxRedemptions, startsAt: campaign.startsAt.toISOString(), endsAt: campaign.endsAt?.toISOString() ?? null },
    targetSnapshot: { eventId: event.id, companyId: event.companyId, eventSeriesId: event.eventSeriesId, venueId: event.venueId,
      companyTargets: campaign.companyTargets.map(t => t.companyId), eventSeriesTargets: campaign.eventSeriesTargets.map(t => t.eventSeriesId),
      eventTargets: campaign.eventTargets.map(t => t.eventId), venueTargets: campaign.venueTargets.map(t => t.venueId) },
    sourceSnapshot: { campaign: campaign.source, code: current.source, batch: current.batchId },
  };
  if (campaign.kind === "STORED_VALUE") {
    const balance = current.balance!;
    const changed = await tx.voucherBalance.updateMany({ where: { id: balance.id, status: "ACTIVE",
      balanceMinor: balance.balanceMinor, reservedMinor: balance.reservedMinor },
      data: { reservedMinor: { increment: price.voucherAmountMinor } } });
    if (changed.count !== 1) throw new VoucherError("NO_BALANCE");
    const use = await tx.voucherBalanceUse.create({ data: { ...common, balanceId: balance.id, amountMinor: price.voucherAmountMinor } });
    await tx.voucherBalanceEntry.create({ data: { balanceId: balance.id, useId: use.id, type: "RESERVE",
      operationKey: `voucher:reserve:${use.id}`, amountMinor: price.voucherAmountMinor, balanceDeltaMinor: 0,
      reservedDeltaMinor: price.voucherAmountMinor, currency: "EUR", reason: "Booking reservation" } });
  } else {
    await tx.voucherRedemption.create({ data: { ...common, eligibleQuantity: price.eligibleQuantity,
      eligibleAmountMinor: price.eligibleAmountMinor, discountAmountMinor: price.discountAmountMinor } });
  }
  await tx.bookingPrice.create({ data: { bookingId: booking.id, eventId: event.id, companyId: event.companyId,
    currency: price.currency, unitPriceMinor: price.unitPriceMinor, quantity: price.quantity,
    originalAmountMinor: price.originalAmountMinor, discountAmountMinor: price.discountAmountMinor,
    voucherAmountMinor: price.voucherAmountMinor, payableAmountMinor: price.payableAmountMinor, calculationVersion: 1 } });
  return { bookingId: booking.id, price, replay: false };
}

export async function releaseVoucherInTransaction(tx: Tx, bookingId: string): Promise<{ released: boolean }> {
  if (typeof bookingId !== "string" || !bookingId || bookingId.length > 191) throw new VoucherError("INVALID_INPUT");
  await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${bookingId} FOR UPDATE`;
  const booking = await tx.booking.findUnique({ where: { id: bookingId }, include: bookingInclude });
  if (!booking) throw new VoucherError("INVALID_INPUT");
  // Only a trusted settlement worker may persist EXPIRED after Stripe verification.
  // Neither a caller-supplied boolean nor reservedUntil is accepted as proof.
  if (booking.status !== "EXPIRED" || (booking.payment && booking.payment.status !== "EXPIRED")) throw new VoucherError("RELEASE_UNSAFE");
  if (booking.voucherRedemption && booking.voucherBalanceUses.length || booking.voucherBalanceUses.length > 1) throw new VoucherError("BOOKING_CONFLICT");
  const item = booking.voucherRedemption ?? booking.voucherBalanceUses[0];
  if (!item || item.status === "RELEASED") return { released: false };
  if (item.status !== "RESERVED") throw new VoucherError("RELEASE_UNSAFE");
  await tx.$queryRaw`SELECT "id" FROM "VoucherCampaign" WHERE "id" = ${item.campaignId} FOR UPDATE`;
  if (booking.voucherRedemption) {
    await tx.voucherRedemption.update({ where: { id: item.id }, data: { status: "RELEASED", releasedAt: new Date(), reservedUntil: null } });
  } else {
    const use = booking.voucherBalanceUses[0];
    await tx.$queryRaw`SELECT "id" FROM "VoucherBalance" WHERE "id" = ${use.balanceId} FOR UPDATE`;
    const changed = await tx.voucherBalance.updateMany({ where: { id: use.balanceId, reservedMinor: { gte: use.amountMinor } },
      data: { reservedMinor: { decrement: use.amountMinor } } });
    if (changed.count !== 1) throw new VoucherError("UNAVAILABLE");
    await tx.voucherBalanceUse.update({ where: { id: use.id }, data: { status: "RELEASED", releasedAt: new Date(), reservedUntil: null } });
    await tx.voucherBalanceEntry.create({ data: { balanceId: use.balanceId, useId: use.id, type: "RELEASE",
      operationKey: `voucher:release:${use.id}`, amountMinor: use.amountMinor, balanceDeltaMinor: 0,
      reservedDeltaMinor: -use.amountMinor, currency: "EUR", reason: "Verified expired booking" } });
  }
  return { released: true };
}

/**
 * Internal composition boundary, NOT a Server Action. The trusted caller creates
 * the pending Booking and, later, its Payment in this same transaction. Callbacks
 * may be retried; no Stripe/SMTP calls or other external side effects inside them.
 * Do not catch domain failures inside the callback: all writes must roll back.
 */
export async function withVoucherTransaction<T>(work: (context: {
  tx: Tx; reserve: (input: VoucherReservationInput) => Promise<ReservedVoucher>;
}) => Promise<T>): Promise<VoucherResult<T>> {
  try {
    const userId = (await auth())?.user?.id ?? null;
    const value = await voucherTransaction(tx => work({ tx, reserve: input => reserveVoucherInTransaction(tx, input, userId) }));
    return { ok: true, value };
  } catch (error) { return voucherFailure(error); }
}

/** Internal worker helper; no public route. Never marks a booking/payment expired itself. */
export async function releaseExpiredVoucherReservation(bookingId: string): Promise<VoucherResult<{ released: boolean }>> {
  try { return { ok: true, value: await voucherTransaction(tx => releaseVoucherInTransaction(tx, bookingId)) }; }
  catch (error) { return voucherFailure(error); }
}
