import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Prisma, type VoucherBalance, type VoucherCampaign, type VoucherCode } from "@prisma/client";
import { createBookingToken, readBookingToken } from "@/lib/bookings/public-token";
import { quoteVoucher, withVoucherTransaction, releaseExpiredVoucherReservation } from "@/lib/vouchers/service";
import { requireVoucherCampaignAdmin } from "@/lib/vouchers/authorization";
import type { VoucherTargets } from "@/lib/vouchers/eligibility";

vi.mock("server-only", () => ({}));
const { db, auth } = vi.hoisted(() => ({
  auth: vi.fn(),
  db: {
    $transaction: vi.fn(), $queryRaw: vi.fn(),
    event: { findUnique: vi.fn() }, booking: { findUnique: vi.fn() },
    voucherCode: { findMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    voucherCampaign: { findUnique: vi.fn() },
    voucherRedemption: { count: vi.fn(), create: vi.fn(), update: vi.fn() },
    voucherBalanceUse: { count: vi.fn(), create: vi.fn(), update: vi.fn() },
    voucherBalance: { updateMany: vi.fn() }, voucherBalanceEntry: { create: vi.fn() },
    bookingPrice: { create: vi.fn() }, user: { findUnique: vi.fn() }, companyMembership: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("@/auth", () => ({ auth }));
let code: VoucherCode & { campaign: VoucherCampaign & VoucherTargets; balance: VoucherBalance | null };
let input: { eventId: string; quantity: number; email: string; code: string; token: string };
let booking: Record<string, unknown>;
const now = new Date();
const scope = { companyTargets: [{ companyId: "company" }], eventSeriesTargets: [], eventTargets: [], venueTargets: [] };
const conflict = () => new Prisma.PrismaClientKnownRequestError("transaction conflict", { code: "P2034", clientVersion: "7" });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AUTH_SECRET", "test-only-token-secret");
  vi.stubEnv("VOUCHER_CODE_DIGEST_KEYS", JSON.stringify({ active: 1, keys: { 1: Buffer.alloc(32, 1).toString("base64") } }));
  auth.mockResolvedValue(null);
  db.$transaction.mockImplementation(async work => work(db));
  db.$queryRaw.mockResolvedValue([]);
  code = {
    id: "code", campaignId: "campaign", codeDigest: "digest", digestVersion: 1, codeSuffix: "TEST", mode: "PUBLIC", status: "ACTIVE",
    maxRedemptions: null, startsAt: null, endsAt: null, assignedUserId: null, source: null, batchId: null, createdAt: now, updatedAt: now,
    balance: null,
    campaign: { id: "campaign", number: 1, name: "Campaign", kind: "PERCENTAGE", status: "ACTIVE", percentageBps: 2000,
      amountMinor: null, currency: "EUR", startsAt: new Date(0), endsAt: null, maxRedemptions: null,
      maxRedemptionsPerCustomer: null, maxEligibleTicketsPerBooking: null, ruleVersion: 1, policy: null,
      source: "influencer", ownerCompanyId: "company", createdById: "admin", createdAt: now, updatedAt: now, ...scope },
  };
  input = { eventId: "event", quantity: 2, email: "guest@example.com", code: "PRIVATE_CODE", token: createBookingToken("event", "20.00", "EUR") };
  booking = { id: readBookingToken(input.token)!.id, eventId: "event", quantity: 2, customerEmail: input.email,
    userId: null, platform: null, status: "PENDING_PAYMENT", reservedUntil: new Date(Date.now() + 35 * 60000),
    payment: null, price: null, voucherRedemption: null, voucherBalanceUses: [] };
  db.booking.findUnique.mockImplementation(async () => booking);
  db.voucherCode.findMany.mockImplementation(async () => [code]);
  db.voucherCode.findUniqueOrThrow.mockImplementation(async () => code);
  db.event.findUnique.mockResolvedValue({ id: "event", companyId: "company", eventSeriesId: null, venueId: null, eventSeries: null, venue: null,
    status: "PUBLISHED", beginsAt: new Date(Date.now() + 86400000), ticketPrice: new Prisma.Decimal("20.00"), currency: "EUR" });
  db.voucherRedemption.count.mockResolvedValue(0); db.voucherBalanceUse.count.mockResolvedValue(0);
  db.voucherBalance.updateMany.mockResolvedValue({ count: 1 });
  db.voucherBalanceUse.create.mockImplementation(async ({ data }) => ({ id: "use", status: "RESERVED", ...data }));
  db.voucherRedemption.create.mockImplementation(async ({ data }) => ({ id: "redemption", status: "RESERVED", ...data }));
});
afterEach(() => vi.unstubAllEnvs());
function stored() {
  code.mode = "INDIVIDUAL"; code.campaign.kind = "STORED_VALUE"; code.campaign.percentageBps = null; code.campaign.amountMinor = 5000;
  code.balance = { id: "balance", codeId: code.id, issuerCompanyId: "company", currency: "EUR", initialAmountMinor: 5000,
    balanceMinor: 5000, reservedMinor: 0, status: "ACTIVE", expiresAt: null, issuanceSource: "gift", issuanceReference: null, createdAt: now, updatedAt: now };
}
const reserve = () => withVoucherTransaction(ctx => ctx.reserve(input));

it("quotes without writing and sends only digests to the code lookup", async () => {
  expect(await quoteVoucher(input)).toMatchObject({ ok: true, value: { discountAmountMinor: 800, payableAmountMinor: 3200 } });
  expect(db.bookingPrice.create).not.toHaveBeenCalled();
  expect(JSON.stringify(db.voucherCode.findMany.mock.calls)).not.toContain(input.code);
});
it("reserves a single campaign use for multiple tickets and persists trusted price snapshots", async () => {
  expect(await reserve()).toMatchObject({ ok: true, value: { replay: false, price: { originalAmountMinor: 4000, discountAmountMinor: 800 } } });
  expect(db.voucherRedemption.create).toHaveBeenCalledOnce();
  expect(db.bookingPrice.create).toHaveBeenCalledWith({ data: expect.objectContaining({ unitPriceMinor: 2000, quantity: 2, payableAmountMinor: 3200 }) });
  expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
  expect(db.$queryRaw).toHaveBeenCalled();
});
it("shares campaign limits across public codes while applying code limits and tracking separately", async () => {
  code.campaign.maxRedemptions = 1;
  db.voucherRedemption.count.mockResolvedValue(1);
  expect(await reserve()).toMatchObject({ ok: false, error: { code: "LIMIT_REACHED" } });
  expect(db.voucherRedemption.create).not.toHaveBeenCalled();
  expect(db.voucherRedemption.count.mock.calls[0][0].where.codeId).toBeUndefined();
  code.campaign.maxRedemptions = null; code.maxRedemptions = 1;
  expect(await reserve()).toMatchObject({ ok: false, error: { code: "LIMIT_REACHED" } });
  expect(db.voucherRedemption.count.mock.lastCall?.[0].where.codeId).toBe("code");
  db.voucherRedemption.count.mockResolvedValue(0); code.source = "yoga-felix"; code.batchId = "batch-felix";
  expect((await reserve()).ok).toBe(true);
  expect(db.voucherRedemption.create).toHaveBeenCalledWith({ data: expect.objectContaining({ codeId: "code", sourceSnapshot: { campaign: "influencer", code: "yoga-felix", batch: "batch-felix" } }) });
});
it("applies individual discount-code default and explicit stored-value use limits", async () => {
  code.mode = "INDIVIDUAL";
  db.voucherRedemption.count.mockResolvedValue(1);
  expect(await reserve()).toMatchObject({ ok: false, error: { code: "LIMIT_REACHED" } });
  stored(); db.voucherRedemption.count.mockResolvedValue(0);
  code.maxRedemptions = 1; db.voucherBalanceUse.count.mockResolvedValue(1);
  expect(await reserve()).toMatchObject({ ok: false, error: { code: "LIMIT_REACHED" } });
});
it("uses frozen normalized guest email as soft identity and session user ID for accounts", async () => {
  code.campaign.maxRedemptionsPerCustomer = 1; input.email = " GUEST@EXAMPLE.COM ";
  expect((await reserve()).ok).toBe(true);
  expect(db.voucherRedemption.count).toHaveBeenCalledWith({ where: expect.objectContaining({ userId: null,
    ruleSnapshot: { path: ["customer", "guestEmail"], equals: "guest@example.com" } }) });
  auth.mockResolvedValue({ user: { id: "account" } }); booking.userId = "account";
  expect((await reserve()).ok).toBe(true);
  expect(db.voucherRedemption.count.mock.lastCall?.[0].where).toMatchObject({ userId: "account" });
  expect(db.voucherRedemption.count.mock.lastCall?.[0].where.ruleSnapshot).toBeUndefined();
});
it("reserves balance and journal atomically, preserving remaining value and no checkout for zero", async () => {
  stored();
  expect(await reserve()).toMatchObject({ ok: true, value: { price: { voucherAmountMinor: 4000, requiresCheckout: false } } });
  expect(db.voucherBalance.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { reservedMinor: { increment: 4000 } } }));
  expect(db.voucherBalanceEntry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "RESERVE", amountMinor: 4000, balanceDeltaMinor: 0, reservedDeltaMinor: 4000 }) });
  expect(db.voucherRedemption.create).not.toHaveBeenCalled();
});
it("respects other balance reservations and issuer company", async () => {
  stored(); code.balance!.reservedMinor = 4500;
  expect(await reserve()).toMatchObject({ ok: true, value: { price: { voucherAmountMinor: 500, payableAmountMinor: 3500 } } });
  code.balance!.issuerCompanyId = "other";
  expect(await reserve()).toMatchObject({ ok: false, error: { code: "INVALID_CODE" } });
});
it("rejects ambiguous rotated codes and empty campaign targets", async () => {
  db.voucherCode.findMany.mockResolvedValue([code, { ...code, id: "duplicate" }]);
  expect(await reserve()).toMatchObject({ ok: false, error: { code: "INVALID_CODE" } });
  db.voucherCode.findMany.mockResolvedValue([code]); code.campaign.companyTargets = [];
  expect(await reserve()).toMatchObject({ ok: false, error: { code: "INVALID_CODE" } });
});
it("replays immutable reservation without counting or writing again, even after campaign pause", async () => {
  await reserve();
  booking.voucherRedemption = { id: "redemption", status: "RESERVED", ...db.voucherRedemption.create.mock.calls[0][0].data };
  booking.price = db.bookingPrice.create.mock.calls[0][0].data;
  code.campaign.status = "PAUSED";
  expect(await reserve()).toMatchObject({ ok: true, value: { replay: true } });
  expect(db.voucherRedemption.create).toHaveBeenCalledOnce();
  expect(db.bookingPrice.create).toHaveBeenCalledOnce();
  input.quantity = 3;
  expect(await reserve()).toMatchObject({ ok: false, error: { code: "BOOKING_CONFLICT" } });
  input.quantity = 2; code.id = "other-code";
  expect(await reserve()).toMatchObject({ ok: false, error: { code: "BOOKING_CONFLICT" } });
});
it("rejects mismatched event, tampered token and already-created checkout", async () => {
  input.eventId = "other";
  expect(await reserve()).toMatchObject({ ok: false, error: { code: "BOOKING_CONFLICT" } });
  input.eventId = "event"; input.token += "tampered";
  expect(await reserve()).toMatchObject({ ok: false, error: { code: "BOOKING_CONFLICT" } });
  input.token = createBookingToken("event", "20.00", "EUR"); booking.id = readBookingToken(input.token)!.id; booking.payment = { status: "PENDING" };
  expect(await reserve()).toMatchObject({ ok: false, error: { code: "BOOKING_CONFLICT" } });
  expect(db.bookingPrice.create).not.toHaveBeenCalled();
});
it("rechecks the authoritative event price against the signed token", async () => {
  db.event.findUnique.mockResolvedValue({ ...await db.event.findUnique(), ticketPrice: new Prisma.Decimal("25.00") });
  expect(await reserve()).toMatchObject({ ok: false, error: { code: "PRICE_CHANGED" } });
  expect(db.voucherRedemption.create).not.toHaveBeenCalled();
});
it("retries serialization failures at most three times and rechecks limits on retry", async () => {
  code.campaign.maxRedemptions = 1;
  db.$transaction.mockRejectedValueOnce(conflict()).mockImplementation(async work => { db.voucherRedemption.count.mockResolvedValue(1); return work(db); });
  expect(await reserve()).toMatchObject({ ok: false, error: { code: "LIMIT_REACHED" } });
  expect(db.$transaction).toHaveBeenCalledTimes(2);
  db.$transaction.mockReset().mockRejectedValue(conflict());
  expect(await reserve()).toMatchObject({ ok: false, error: { code: "UNAVAILABLE" } });
  expect(db.$transaction).toHaveBeenCalledTimes(4);
});
it("propagates a journal write failure to the transaction boundary without leaking details", async () => {
  stored(); db.voucherBalanceEntry.create.mockRejectedValue(new Error(input.code));
  expect(await reserve()).toMatchObject({ ok: false, error: { code: "UNAVAILABLE" } });
  expect(db.bookingPrice.create).not.toHaveBeenCalled();
  expect(db.$transaction).toHaveBeenCalledOnce();
});
it("never releases on local timeout or a still-pending payment", async () => {
  booking.reservedUntil = new Date(0);
  expect(await releaseExpiredVoucherReservation(String(booking.id))).toMatchObject({ ok: false, error: { code: "RELEASE_UNSAFE" } });
  booking.status = "EXPIRED"; booking.payment = { status: "PENDING" };
  expect(await releaseExpiredVoucherReservation(String(booking.id))).toMatchObject({ ok: false, error: { code: "RELEASE_UNSAFE" } });
  expect(db.voucherBalance.updateMany).not.toHaveBeenCalled();
});
it("releases only reserved value once after verified expiry and leaves the price snapshot intact", async () => {
  stored(); await reserve();
  const use = { id: "use", status: "RESERVED", ...db.voucherBalanceUse.create.mock.calls[0][0].data };
  booking.voucherBalanceUses = [use]; booking.status = "EXPIRED"; booking.payment = { status: "EXPIRED" };
  db.voucherBalanceUse.update.mockImplementation(async () => { use.status = "RELEASED"; });
  expect(await releaseExpiredVoucherReservation(String(booking.id))).toEqual({ ok: true, value: { released: true } });
  expect(await releaseExpiredVoucherReservation(String(booking.id))).toEqual({ ok: true, value: { released: false } });
  expect(db.voucherBalanceEntry.create).toHaveBeenCalledTimes(2); // reserve + release
  expect(db.voucherBalanceEntry.create.mock.lastCall?.[0].data).toMatchObject({ type: "RELEASE", balanceDeltaMinor: 0, reservedDeltaMinor: -4000 });
  expect(db.bookingPrice.create).toHaveBeenCalledOnce();
});
it("allows active owner-company members or platform admins to manage a campaign", async () => {
  auth.mockResolvedValue({ user: { id: "actor" } });
  db.user.findUnique.mockResolvedValue({ role: "USER" });
  db.voucherCampaign.findUnique.mockResolvedValue({ id: "campaign", ownerCompanyId: "company" });
  db.companyMembership.findUnique.mockResolvedValue({ status: "ACTIVE", role: "COMPANY_USER" });
  await expect(requireVoucherCampaignAdmin("campaign")).resolves.toMatchObject({ companyId: "company", platformAdmin: false });
  db.companyMembership.findUnique.mockResolvedValue({ status: "ACTIVE", role: "COMPANY_ADMIN" });
  await expect(requireVoucherCampaignAdmin("campaign")).resolves.toMatchObject({ companyId: "company", platformAdmin: false });
  db.companyMembership.findUnique.mockResolvedValue(null);
  await expect(requireVoucherCampaignAdmin("campaign")).rejects.toThrow();
  db.user.findUnique.mockResolvedValue({ role: "ADMIN" });
  await expect(requireVoucherCampaignAdmin("campaign")).resolves.toMatchObject({ platformAdmin: true });
});

it("releases a discount reservation idempotently without changing its price or spending it", async () => {
  await reserve();
  const redemption = { id: "redemption", status: "RESERVED", ...db.voucherRedemption.create.mock.calls[0][0].data };
  booking.voucherRedemption = redemption; booking.status = "EXPIRED";
  db.voucherRedemption.update.mockImplementation(async () => { redemption.status = "RELEASED"; });
  expect(await releaseExpiredVoucherReservation(String(booking.id))).toMatchObject({ ok: true, value: { released: true } });
  expect(await releaseExpiredVoucherReservation(String(booking.id))).toMatchObject({ ok: true, value: { released: false } });
  expect(db.voucherRedemption.update).toHaveBeenCalledOnce();
  expect(db.voucherBalanceEntry.create).not.toHaveBeenCalled();
});

it("does not use expiry release as a refund for committed value", async () => {
  booking.status = "EXPIRED"; booking.payment = { status: "EXPIRED" };
  booking.voucherRedemption = { id: "redemption", campaignId: "campaign", status: "COMMITTED" };
  expect(await releaseExpiredVoucherReservation(String(booking.id))).toMatchObject({ ok: false, error: { code: "RELEASE_UNSAFE" } });
  expect(db.voucherRedemption.update).not.toHaveBeenCalled();
});

it.each(["campaign", "code", "balance"])("retries two overlapping %s reservations against the winning commit (simulated Serializable)", async limit => {
 // Optimistic transaction double: both first attempts read version zero;
 // only one commits, the other must retry against the new state. No PostgreSQL proof.
 if (limit === "campaign") code.campaign.maxRedemptions = 1;
 if (limit === "code") code.maxRedemptions = 1;
 if (limit === "balance") { stored(); code.balance!.balanceMinor = 4000; }
 const second = { ...input, token: createBookingToken("event", "20.00", "EUR") };
 const bookings = new Map([[String(booking.id), booking], [readBookingToken(second.token)!.id, { ...booking, id: readBookingToken(second.token)!.id }]]);
 let version = 0, committedUses = 0, reservedMinor = 0, arrivals = 0;
 let open!: () => void;
 const barrier = new Promise<void>(resolve => { open = resolve; });
 db.$transaction.mockImplementation(async work => {
  const readVersion = version, localCode = structuredClone(code), readCount = committedUses;
  if (localCode.balance) localCode.balance.reservedMinor = reservedMinor;
  const tx = { ...db,
   booking: { findUnique: vi.fn(async ({ where }) => bookings.get(where.id)) },
   voucherCode: { findMany: vi.fn(async () => [localCode]), findUniqueOrThrow: vi.fn(async () => localCode) },
   voucherRedemption: { ...db.voucherRedemption, count: vi.fn(async () => limit === "balance" ? 0 : readCount) },
   voucherBalanceUse: { ...db.voucherBalanceUse, count: vi.fn(async () => limit === "balance" ? readCount : 0) },
  };
  const result = await work(tx);
  if (readVersion === 0) { if (++arrivals === 2) open(); await barrier; }
  if (version !== readVersion) throw conflict();
  version++; committedUses++; if (limit === "balance") reservedMinor += 4000;
  return result;
 });
 const results = await Promise.all([reserve(), withVoucherTransaction(ctx => ctx.reserve(second))]);
 expect(results.filter(result => result.ok)).toHaveLength(1);
 expect(results.find(result => !result.ok)).toMatchObject({ ok: false, error: { code: limit === "balance" ? "NO_BALANCE" : "LIMIT_REACHED" } });
 expect(committedUses).toBe(1); expect(db.$transaction).toHaveBeenCalledTimes(3);
 if (limit === "balance") expect(reservedMinor).toBe(4000);
});
