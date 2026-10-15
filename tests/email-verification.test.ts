import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { claimMemberships, claimVerifiedAssignments } from "@/lib/companies/claim-memberships";
import { getVerificationEmail, sendVerificationEmail, verifyEmailToken } from "@/lib/auth/verification";
import { sendMail } from "@/lib/mail";
const { db } = vi.hoisted(() => ({ db: {
  $transaction: vi.fn(), user: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  verificationToken: { create: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn() },
  companyMembership: { updateMany: vi.fn() }, eventStaff: { updateMany: vi.fn() }, venueStaff: { updateMany: vi.fn() }, trainer: { findMany: vi.fn(), updateMany: vi.fn() },
} }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("@/lib/mail", () => ({ sendMail: vi.fn() }));
const user = { id: "user-1", email: "ADA@example.com", emailVerified: new Date() };
const token = "a".repeat(43);
beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation((fn) => fn(db));
  db.user.findUnique.mockResolvedValue(user); db.user.findMany.mockResolvedValue([user]);
  db.trainer.findMany.mockResolvedValue([{ id: "trainer-a", companyId: "company-a", userId: null }, { id: "trainer-b", companyId: "company-b", userId: null }]);
  db.verificationToken.deleteMany.mockResolvedValue({ count: 1 });
  db.verificationToken.findUnique.mockResolvedValue({ token: createHash("sha256").update(token).digest("hex"), identifier: JSON.stringify({ purpose: "verify-email", userId: user.id, email: "ada@example.com" }), expires: new Date(Date.now() + 60_000) });
});
it("displays the bound email without consuming the token or verifying the user", async () => {
  expect(await getVerificationEmail(token)).toBe(user.email);
  expect(db.verificationToken.deleteMany).not.toHaveBeenCalled();
  expect(db.user.update).not.toHaveBeenCalled();
});
it.each(["expired", "missing", "ambiguous", "changed-user", "malformed", "invalid-binding"])("does not disclose an email for a %s token", async (scenario) => {
  if (scenario === "expired") db.verificationToken.findUnique.mockResolvedValue({ expires: new Date(0) });
  if (scenario === "missing") db.verificationToken.findUnique.mockResolvedValue(null);
  if (scenario === "ambiguous") db.user.findMany.mockResolvedValue([user, { ...user, id: "other" }]);
  if (scenario === "changed-user") db.user.findMany.mockResolvedValue([{ ...user, id: "other" }]);
  if (scenario === "invalid-binding") db.verificationToken.findUnique.mockResolvedValue({ expires: new Date(Date.now() + 60_000), identifier: "null" });
  expect(await getVerificationEmail(scenario === "malformed" ? "bad" : token)).toBeNull();
});
it("never claims before verification, even if a caller supplies a forged verified timestamp", async () => {
  await claimMemberships({ ...user, emailVerified: null }); expect(db.$transaction).not.toHaveBeenCalled();
  db.user.findUnique.mockResolvedValue({ ...user, emailVerified: null });
  await claimMemberships(user);
  expect(db.companyMembership.updateMany).not.toHaveBeenCalled(); expect(db.trainer.updateMany).not.toHaveBeenCalled();
});
it("atomically claims all four assignment types using the verified database identity", async () => {
  await claimMemberships(user);
  expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
  for (const model of [db.eventStaff, db.venueStaff, db.trainer, db.companyMembership]) {
    expect(model.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: null, email: { equals: "ada@example.com", mode: "insensitive" } }), data: expect.objectContaining({ userId: user.id }) }));
  }
  expect(db.companyMembership.updateMany.mock.calls[0][0].where.status).toEqual({ in: ["ACTIVE", "INVITED"] });
  expect(db.trainer.updateMany.mock.calls[0][0].where).not.toHaveProperty("companyId");
  expect(db.trainer.updateMany.mock.calls[0][0].where.id.in).toEqual(["trainer-a", "trainer-b"]);
});
it("skips ambiguous trainer profiles within one company", async () => {
  db.trainer.findMany.mockResolvedValue([{ id: "one", companyId: "company-a", userId: null }, { id: "two", companyId: "company-a", userId: null }]);
  await claimMemberships(user); expect(db.trainer.updateMany).not.toHaveBeenCalled();
});
it("does not claim ambiguous case-insensitive user identities", async () => {
  db.user.findMany.mockResolvedValue([user, { id: "another" }]);
  await claimMemberships(user); expect(db.eventStaff.updateMany).not.toHaveBeenCalled(); expect(db.trainer.updateMany).not.toHaveBeenCalled();
});
it("retries an entire transaction after a serialization conflict", async () => {
  db.$transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("retry", { code: "P2034", clientVersion: "test" }));
  await claimMemberships(user); expect(db.$transaction).toHaveBeenCalledTimes(2);
});
it("stores only a hash and sends a separate expiring verification link", async () => {
  db.user.findMany.mockResolvedValue([{ ...user, emailVerified: null }]);
  await sendVerificationEmail("ada@example.com");
  const mail = vi.mocked(sendMail).mock.calls[0][0];
  const raw = mail.text.match(/verify-email#([A-Za-z0-9_-]{43})/)![1];
  const data = db.verificationToken.create.mock.calls[0][0].data;
  expect(data.token).toBe(createHash("sha256").update(raw).digest("hex"));
  expect(data.expires.getTime() - Date.now()).toBeGreaterThan(23 * 60 * 60 * 1000);
  expect(db.user.update).not.toHaveBeenCalled(); expect(db.eventStaff.updateMany).not.toHaveBeenCalled();
});
it.each(["expired", "used", "ambiguous", "changed-email", "malformed"])("rejects %s verification without activating the account", async (scenario) => {
  if (scenario === "expired") db.verificationToken.findUnique.mockResolvedValue({ expires: new Date(0) });
  if (scenario === "used") db.verificationToken.deleteMany.mockResolvedValue({ count: 0 });
  if (scenario === "ambiguous") db.user.findMany.mockResolvedValue([user, { id: "other" }]);
  if (scenario === "changed-email") db.user.findMany.mockResolvedValue([]);
  expect(await verifyEmailToken(scenario === "malformed" ? "bad" : token)).toBe(false);
  expect(db.user.update).not.toHaveBeenCalled(); expect(db.eventStaff.updateMany).not.toHaveBeenCalled();
});
it("verifies, consumes the token, and claims all roles in the same transaction", async () => {
  expect(await verifyEmailToken(token)).toBe(true);
  expect(db.user.update).toHaveBeenCalledWith({ where: { id: user.id }, data: { emailVerified: expect.any(Date) } });
  expect(db.eventStaff.updateMany).toHaveBeenCalled(); expect(db.trainer.updateMany).toHaveBeenCalled();
  expect(db.$transaction).toHaveBeenCalledTimes(1);
});
it("propagates assignment failures so the verification transaction rolls back", async () => {
  db.trainer.updateMany.mockRejectedValue(new Error("database failure"));
  await expect(verifyEmailToken(token)).rejects.toThrow("database failure");
  expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
});
it("checks verification within a caller's transaction", async () => {
  db.user.findUnique.mockResolvedValue(null);
  await claimVerifiedAssignments(db as unknown as Prisma.TransactionClient, user.id);
  expect(db.user.findMany).not.toHaveBeenCalled();
});
