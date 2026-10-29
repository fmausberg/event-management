import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { saveVoucherCampaign, changeVoucherCampaignStatus, issueVoucherCodes, changeVoucherCodeStatus } from "@/lib/vouchers/admin-service";
import { voucherCodeDigests } from "@/lib/vouchers/codes";
import { createCodes } from "@/app/company/[companyKey]/vouchers/actions";

const { db, auth } = vi.hoisted(() => ({ auth: vi.fn(), db: {
  $transaction: vi.fn(), $queryRaw: vi.fn(), $executeRaw: vi.fn(), user: { findUnique: vi.fn(), findFirst: vi.fn() }, companyMembership: { findUnique: vi.fn() },
  company: { findUnique: vi.fn(), count: vi.fn() }, eventSeries: { count: vi.fn() }, event: { count: vi.fn() }, venue: { count: vi.fn() },
  voucherCampaign: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  voucherCampaignCompany: { createMany: vi.fn(), deleteMany: vi.fn() }, voucherCampaignEventSeries: { createMany: vi.fn(), deleteMany: vi.fn() },
  voucherCampaignEvent: { createMany: vi.fn(), deleteMany: vi.fn() }, voucherCampaignVenue: { createMany: vi.fn(), deleteMany: vi.fn() },
  voucherCode: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), groupBy: vi.fn(), create: vi.fn(), update: vi.fn() },
  voucherBalance: { create: vi.fn() }, voucherBalanceEntry: { create: vi.fn() },
} }));
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
function campaign() {
  return { id: "campaign", name: "Promo", ownerCompanyId: "company", kind: "PERCENTAGE", currency: "EUR", percentageBps: 1000, amountMinor: null as number | null,
    status: "DRAFT", startsAt: new Date("2099-01-01T09:00:00Z"), endsAt: null, maxRedemptions: null, maxRedemptionsPerCustomer: null, maxEligibleTicketsPerBooking: null,
    source: null, policy: null, ruleVersion: 1, _count: { codes: 0, redemptions: 0, balanceUses: 0 },
    companyTargets: [{ companyId: "company" }], eventSeriesTargets: [] as { eventSeriesId: string }[], eventTargets: [] as { eventId: string }[], venueTargets: [] as { venueId: string }[] };
}
const values = (overrides = {}) => ({ name: "Promo", description: "Interne Beschreibung", kind: "PERCENTAGE", currency: "EUR", value: "10", startsAt: "2099-01-01T10:00", endsAt: "",
  maxRedemptions: "", maxRedemptionsPerCustomer: "", maxEligibleTicketsPerBooking: "", source: "", companyIds: ["company"], seriesIds: [], eventIds: [], venueIds: [], ...overrides });
const issue = (overrides = {}) => ({ requestId: randomUUID(), mode: "INDIVIDUAL", count: 2, publicCode: "", maxRedemptions: "", assignedUserId: "", source: "source", expiresAt: "", ...overrides });
let current = campaign();
let saved: { id: string; campaignId: string; batchId: string; codeDigest: string; digestVersion: number }[];
beforeEach(() => {
  vi.resetAllMocks(); current = campaign(); saved = [];
  vi.stubEnv("VOUCHER_CODE_DIGEST_KEYS", JSON.stringify({ active: 1, keys: { 1: randomBytes(32).toString("base64") } }));
  auth.mockResolvedValue({ user: { id: "actor" } }); db.user.findUnique.mockResolvedValue({ role: "USER" });
  db.companyMembership.findUnique.mockResolvedValue({ role: "COMPANY_ADMIN", status: "ACTIVE" });
  db.company.findUnique.mockResolvedValue({ id: "company", slug: "studio", name: "Studio" });
  for (const table of [db.company, db.eventSeries, db.event, db.venue]) table.count.mockImplementation(async ({ where }) => where.id.in.length);
  db.voucherCampaign.findUnique.mockImplementation(async () => structuredClone(current));
  db.voucherCampaign.create.mockResolvedValue({ id: "campaign" }); db.voucherCampaign.update.mockResolvedValue({ id: "campaign" });
  db.voucherCode.findMany.mockImplementation(async ({ where }) => saved.filter(code => code.batchId === where.batchId));
  db.voucherCode.count.mockResolvedValue(0); db.voucherCode.groupBy.mockResolvedValue([{ digestVersion: 1 }]);
  db.voucherCode.create.mockImplementation(async ({ data }) => { saved.push(data); return data; });
  db.voucherBalance.create.mockResolvedValue({ id: "balance" });
  db.$transaction.mockImplementation(async work => { const snapshot = structuredClone(saved); try { return await work(db); } catch (error) { saved = snapshot; throw error; } });
});
afterEach(() => vi.unstubAllEnvs());
it("allows an active owner-company admin to save combined targets transactionally", async () => {
  expect(await saveVoucherCampaign("studio", null, values({ seriesIds: ["series"], eventIds: ["event"], venueIds: ["venue"] }))).toBe("campaign");
  expect(db.voucherCampaign.create).toHaveBeenCalledWith({ data: expect.objectContaining({ ownerCompanyId: "company", createdById: "actor", percentageBps: 1000, policy: { adminDescription: "Interne Beschreibung" } }) });
  for (const table of [db.voucherCampaignCompany, db.voucherCampaignEventSeries, db.voucherCampaignEvent, db.voucherCampaignVenue]) expect(table.createMany).toHaveBeenCalledOnce();
  expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
});
it.each(["company", "eventSeries", "event", "venue"] as const)("rejects missing or foreign %s targets", async table => {
  db[table].count.mockResolvedValue(0);
  await expect(saveVoucherCampaign("studio", null, values({ seriesIds: ["foreign"], eventIds: ["foreign"], venueIds: ["foreign"] }))).rejects.toThrow("Ziel");
  expect(db.voucherCampaign.create).not.toHaveBeenCalled();
});
it("allows an active company user to create campaigns, issue codes, and change campaign and code status", async () => {
  db.companyMembership.findUnique.mockResolvedValue({ role: "COMPANY_USER", status: "ACTIVE" });
  await expect(saveVoucherCampaign("studio", null, values())).resolves.toBe("campaign");
  await expect(issueVoucherCodes("studio", "campaign", issue({ count: 1 }))).resolves.toMatchObject({ replay: false, codes: [expect.any(String)] });
  await expect(changeVoucherCampaignStatus("studio", "campaign", "PAUSED")).resolves.toBeUndefined();
  db.voucherCode.findFirst.mockResolvedValue({ status: "ACTIVE" });
  await expect(changeVoucherCodeStatus("studio", "campaign", "code", "DISABLED")).resolves.toBeUndefined();
});
it.each(["INVITED", "SUSPENDED"])("rejects a company user with %s membership", async status => {
  db.companyMembership.findUnique.mockResolvedValue({ role: "COMPANY_USER", status });
  await expect(issueVoucherCodes("studio", "campaign", issue())).rejects.toThrow();
  expect(db.voucherCode.create).not.toHaveBeenCalled();
});
it("rejects writes by a company user who only belongs to another company", async () => {
  db.companyMembership.findUnique.mockResolvedValue(null);
  await expect(saveVoucherCampaign("studio", null, values())).rejects.toThrow();
  expect(db.voucherCampaign.create).not.toHaveBeenCalled();
});
it("rejects a foreign campaign even when its ID is posted to an authorized company URL", async () => {
  current.ownerCompanyId = "foreign";
  await expect(changeVoucherCampaignStatus("studio", "campaign", "ACTIVE")).rejects.toThrow();
  expect(db.voucherCampaign.update).not.toHaveBeenCalled();
});
it("allows platform admins cross-company discount targets but scopes value issuance to its owner", async () => {
  db.user.findUnique.mockResolvedValue({ role: "ADMIN" });
  await saveVoucherCampaign("studio", null, values({ eventIds: ["foreign-event"] }));
  expect(db.event.count).toHaveBeenLastCalledWith({ where: { id: { in: ["foreign-event"] } } });
  await saveVoucherCampaign("studio", null, values({ kind: "STORED_VALUE", value: "50", eventIds: ["event"] }));
  expect(db.event.count).toHaveBeenLastCalledWith({ where: { id: { in: ["event"] }, companyId: "company" } });
});
it("blocks activation and code issuance without any explicit target", async () => {
  current.companyTargets = [];
  await expect(changeVoucherCampaignStatus("studio", "campaign", "ACTIVE")).rejects.toThrow("Ziel");
  await expect(issueVoucherCodes("studio", "campaign", issue())).rejects.toThrow("Ziel");
  expect(db.voucherCampaign.update).not.toHaveBeenCalled(); expect(saved).toHaveLength(0);
});
it("freezes rules after first code while allowing descriptive metadata and safe pause", async () => {
  current._count.codes = 1;
  await expect(saveVoucherCampaign("studio", "campaign", values({ value: "20" }))).rejects.toThrow("gesperrt");
  await saveVoucherCampaign("studio", "campaign", values({ name: "Neuer Name" }));
  expect(db.voucherCampaignCompany.deleteMany).not.toHaveBeenCalled();
  await changeVoucherCampaignStatus("studio", "campaign", "PAUSED");
  expect(db.voucherCampaign.update).toHaveBeenLastCalledWith({ where: { id: "campaign" }, data: { status: "PAUSED" } });
});
it("stores only versioned digests and suffixes; a repeated batch never reveals codes again", async () => {
  const input = issue();
  const first = await issueVoucherCodes("studio", "campaign", input);
  expect(db.$executeRaw).toHaveBeenCalled();
  expect(first.codes).toHaveLength(2); expect(new Set(first.codes).size).toBe(2);
  for (const code of first.codes) { expect(JSON.stringify(saved)).not.toContain(code); expect(saved.some(row => voucherCodeDigests(code).some(d => d.codeDigest === row.codeDigest))).toBe(true); }
  expect(await issueVoucherCodes("studio", "campaign", input)).toEqual({ codes: [], replay: true });
  expect(saved).toHaveLength(2);
});
it("creates value balance and immutable ISSUE journal together exactly once", async () => {
  current.kind = "STORED_VALUE"; current.amountMinor = 5000;
  const input = issue({ count: 1, expiresAt: "2099-12-31T23:00" });
  await issueVoucherCodes("studio", "campaign", input); await issueVoucherCodes("studio", "campaign", input);
  expect(db.voucherBalance.create).toHaveBeenCalledExactlyOnceWith({ data: expect.objectContaining({ issuerCompanyId: "company", initialAmountMinor: 5000, balanceMinor: 5000, reservedMinor: 0, expiresAt: new Date("2099-12-31T22:00:00Z"), issuanceSource: "ADMIN" }) });
  expect(db.voucherBalanceEntry.create).toHaveBeenCalledExactlyOnceWith({ data: expect.objectContaining({ type: "ISSUE", operationKey: `voucher:issue:${saved[0].id}`, amountMinor: 5000, balanceDeltaMinor: 5000, reservedDeltaMinor: 0, createdById: "actor" }) });
});
it("rolls back code issuance if the journal insert fails", async () => {
  current.kind = "STORED_VALUE"; current.amountMinor = 5000;
  db.voucherBalanceEntry.create.mockRejectedValue(new Error("journal unavailable"));
  await expect(issueVoucherCodes("studio", "campaign", issue())).rejects.toThrow();
  expect(saved).toHaveLength(0);
});
it("rejects public stored balances and short public codes that would be exposed by a suffix", async () => {
  current.kind = "STORED_VALUE"; current.amountMinor = 5000;
  await expect(issueVoucherCodes("studio", "campaign", issue({ mode: "PUBLIC", count: 1 }))).rejects.toThrow("individuelle");
  current.kind = "PERCENTAGE";
  await expect(issueVoucherCodes("studio", "campaign", issue({ mode: "PUBLIC", count: 1, publicCode: "TEST" }))).rejects.toThrow("acht");
});
it("rejects collisions across retained digest versions and blocks missing historic keys", async () => {
  const keys = { 1: randomBytes(32).toString("base64"), 2: randomBytes(32).toString("base64") };
  vi.stubEnv("VOUCHER_CODE_DIGEST_KEYS", JSON.stringify({ active: 2, keys }));
  db.voucherCode.count.mockImplementation(async ({ where }) => where.OR ? 1 : 0);
  await expect(issueVoucherCodes("studio", "campaign", issue({ mode: "PUBLIC", count: 1, publicCode: "PUBLIC_TEST" }))).rejects.toThrow("anderen Code");
  const lookup = db.voucherCode.count.mock.calls.find(([arg]) => arg.where.OR)?.[0].where.OR;
  expect(lookup).toHaveLength(2); expect(JSON.stringify(lookup)).not.toContain("PUBLIC_TEST");
  vi.stubEnv("VOUCHER_CODE_DIGEST_KEYS", JSON.stringify({ active: 2, keys: { 2: keys[2] } }));
  await expect(issueVoucherCodes("studio", "campaign", issue())).rejects.toThrow("Schlüsselversionen");
});
it("issues multiple distinct public codes for the same campaign with separate tracking", async () => {
  const felix = await issueVoucherCodes("studio", "campaign", issue({ mode: "PUBLIC", count: 1, publicCode: "YOGAFELIX10", source: "felix" }));
  const lena = await issueVoucherCodes("studio", "campaign", issue({ mode: "PUBLIC", count: 1, publicCode: "YOGALENA10", source: "lena" }));
  expect(felix.codes).toEqual(["YOGAFELIX10"]); expect(lena.codes).toEqual(["YOGALENA10"]);
  expect(saved).toHaveLength(2);
  expect(db.voucherCode.create).toHaveBeenNthCalledWith(1, { data: expect.objectContaining({ campaignId: "campaign", mode: "PUBLIC", source: "felix" }) });
  expect(db.voucherCode.create).toHaveBeenNthCalledWith(2, { data: expect.objectContaining({ campaignId: "campaign", mode: "PUBLIC", source: "lena" }) });
});
it("rejects the same normalized public code in one or different campaigns", async () => {
  db.voucherCode.count.mockImplementation(async ({ where }) => where.OR?.some((digest: { codeDigest: string; digestVersion: number }) =>
    saved.some(row => row.codeDigest === digest.codeDigest && row.digestVersion === digest.digestVersion)) ? 1 : 0);
  await issueVoucherCodes("studio", "campaign", issue({ mode: "PUBLIC", count: 1, publicCode: "YogaFelix10" }));
  await expect(issueVoucherCodes("studio", "campaign", issue({ mode: "PUBLIC", count: 1, publicCode: " yogafelix10 " }))).rejects.toThrow("anderen Code");
  await expect(issueVoucherCodes("studio", "another-campaign", issue({ mode: "PUBLIC", count: 1, publicCode: "YOGAFELIX10" }))).rejects.toThrow("anderen Code");
  expect(saved).toHaveLength(1);
});
it("rejects invalid recipient bindings", async () => {
  db.user.findFirst.mockResolvedValue(null);
  await expect(issueVoucherCodes("studio", "campaign", issue({ assignedUserId: "foreign" }))).rejects.toThrow("Empfänger");
});
it("cannot reactivate archived campaigns or codes and never deletes history", async () => {
  current.status = "ARCHIVED";
  await expect(changeVoucherCampaignStatus("studio", "campaign", "ACTIVE")).rejects.toThrow();
  db.voucherCode.findFirst.mockResolvedValue({ status: "ARCHIVED" });
  await expect(changeVoucherCodeStatus("studio", "campaign", "code", "ACTIVE")).rejects.toThrow();
  expect(db.voucherCode.update).not.toHaveBeenCalled();
});
it("does not permanently archive issued stored value without a balance closure policy", async () => {
  current.kind = "STORED_VALUE"; current.amountMinor = 5000; current._count.codes = 1;
  await expect(changeVoucherCampaignStatus("studio", "campaign", "ARCHIVED")).rejects.toThrow("Abschlussregel");
  db.voucherCode.findFirst.mockResolvedValue({ status: "ACTIVE" });
  await expect(changeVoucherCodeStatus("studio", "campaign", "code", "ARCHIVED")).rejects.toThrow("reversibel");
  await changeVoucherCampaignStatus("studio", "campaign", "PAUSED");
  await changeVoucherCodeStatus("studio", "campaign", "code", "DISABLED");
  expect(db.voucherCode.update).toHaveBeenCalledWith({ where: { id: "code" }, data: { status: "DISABLED" } });
});
it("sanitizes action failures without echoing code or low-level errors", async () => {
  const raw = issue({ mode: "PUBLIC", count: 1, publicCode: "SECRET_CODE" });
  const form = new FormData(); for (const [key, value] of Object.entries(raw)) form.set(key, String(value));
  db.voucherCode.create.mockRejectedValue(new Error("SECRET_CODE plus database details"));
  const result = await createCodes("studio", "campaign", {}, form);
  expect(result.success).toBeUndefined(); expect(JSON.stringify(result)).not.toContain("SECRET_CODE");
});
it("retries a serializable collision and returns only the already-issued batch", async () => {
  const input = issue({ count: 1 });
  await issueVoucherCodes("studio", "campaign", input);
  db.$transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("conflict", { code: "P2034", clientVersion: "test" }));
  expect(await issueVoucherCodes("studio", "campaign", input)).toEqual({ codes: [], replay: true });
  expect(saved).toHaveLength(1);
});
it("commits only one batch under overlapping issuance attempts (simulated Serializable)", async () => {
  const input = issue({ count: 1 });
  let version = 0, arrivals = 0; let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  db.$transaction.mockImplementation(async work => {
    const readVersion = version, staged = structuredClone(saved);
    const tx = { ...db, voucherCode: { ...db.voucherCode,
      findMany: vi.fn(async ({ where }) => staged.filter(code => code.batchId === where.batchId)),
      create: vi.fn(async ({ data }) => { staged.push(data); return data; }),
    } };
    const result = await work(tx);
    if (readVersion === 0) { if (++arrivals === 2) release(); await barrier; }
    if (version !== readVersion) throw new Prisma.PrismaClientKnownRequestError("conflict", { code: "P2034", clientVersion: "test" });
    saved = staged; version++; return result;
  });
  const results = await Promise.all([issueVoucherCodes("studio", "campaign", input), issueVoucherCodes("studio", "campaign", input)]);
  expect(results.filter(result => result.replay)).toHaveLength(1);
  expect(results.flatMap(result => result.codes)).toHaveLength(1); expect(saved).toHaveLength(1);
});
