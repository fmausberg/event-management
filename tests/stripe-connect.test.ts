import { beforeEach, expect, it, vi } from "vitest";
import { connectOnboarding, refreshConnectAccount } from "@/lib/payments/connect";
import { startStripeOnboarding } from "@/app/company/[companyKey]/settings/actions";
import { MemberAccessError } from "@/lib/companies/members";
import { reportConnectError } from "@/lib/payments/connect-error";

const { db, stripe, requireCompanyAdmin } = vi.hoisted(() => ({
  db: { company: { findUniqueOrThrow: vi.fn(), updateMany: vi.fn(), update: vi.fn() } },
  stripe: { v2: { core: { accounts: { create: vi.fn(), retrieve: vi.fn() }, accountLinks: { create: vi.fn() } } } },
  requireCompanyAdmin: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("@/lib/payments/stripe", () => ({ getStripe: () => stripe, paymentOrigin: () => "https://events.example.com" }));
vi.mock("@/lib/companies/members", () => ({ requireCompanyAdmin, MemberAccessError: class extends Error {} }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
beforeEach(() => {
  vi.resetAllMocks();
  db.company.findUniqueOrThrow.mockResolvedValue({ id: "company-1", slug: "studio", stripeAccountId: "acct_studio" });
  stripe.v2.core.accountLinks.create.mockResolvedValue({ url: "https://connect.stripe.com/onboarding" });
});
it("creates a direct-charge account with Stripe fee collection and full dashboard access", async () => {
  db.company.findUniqueOrThrow.mockResolvedValueOnce({ id: "company-1", slug: "studio", stripeAccountId: null });
  stripe.v2.core.accounts.create.mockResolvedValue({ id: "acct_studio" });
  expect(await connectOnboarding("company-1", "DE")).toBe("https://connect.stripe.com/onboarding");
  expect(stripe.v2.core.accounts.create).toHaveBeenCalledWith({ identity: { country: "DE" }, dashboard: "full", configuration: { merchant: { capabilities: { card_payments: { requested: true } } } }, defaults: { responsibilities: { fees_collector: "stripe", losses_collector: "stripe" } }, metadata: { companyId: "company-1" } }, { idempotencyKey: "company-connect-company-1" });
  expect(db.company.updateMany).toHaveBeenCalledWith({ where: { id: "company-1", stripeAccountId: null }, data: { stripeAccountId: "acct_studio" } });
});
it("reuses a stored account and only generates a new onboarding link", async () => {
  await connectOnboarding("company-1");
  expect(stripe.v2.core.accounts.create).not.toHaveBeenCalled();
  expect(stripe.v2.core.accountLinks.create).toHaveBeenCalledWith(expect.objectContaining({ account: "acct_studio" }));
});
it("does not treat an onboarding return as account activation", async () => {
  stripe.v2.core.accounts.retrieve.mockResolvedValue({ configuration: { merchant: { capabilities: { card_payments: { status: "pending" }, stripe_balance: { payouts: { status: "inactive" } } } } } });
  await refreshConnectAccount("company-1");
  expect(db.company.update).toHaveBeenCalledWith({ where: { id: "company-1" }, data: { stripeChargesEnabled: false, stripePayoutsEnabled: false } });
});
it("rejects onboarding without company-admin authorization before contacting Stripe", async () => {
  requireCompanyAdmin.mockRejectedValue(new MemberAccessError("FORBIDDEN"));
  await expect(startStripeOnboarding("foreign", new FormData())).rejects.toThrow();
  expect(stripe.v2.core.accounts.create).not.toHaveBeenCalled();
  expect(stripe.v2.core.accountLinks.create).not.toHaveBeenCalled();
});
it("explains missing platform setup without exposing Stripe response details", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  requireCompanyAdmin.mockResolvedValue({ id: "company-1" });
  db.company.findUniqueOrThrow.mockResolvedValue({ id: "company-1", slug: "studio", stripeAccountId: null });
  stripe.v2.core.accounts.create.mockRejectedValue({ type: "StripeInvalidRequestError", code: "non_connect_platform_accounts_v2_access_blocked", requestId: "req_test", message: "private response", headers: { authorization: "secret" } });
  const form = new FormData(); form.set("country", "DE");
  await expect(startStripeOnboarding("studio", form)).rejects.toThrow("/settings?stripe=connect_setup_required");
  expect(log).toHaveBeenCalledWith("Stripe onboarding failed", { type: "StripeInvalidRequestError", code: "non_connect_platform_accounts_v2_access_blocked", requestId: "req_test" });
  expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
  expect(db.company.updateMany).not.toHaveBeenCalled();
});
it.each([
  { type: "StripePermissionError", code: "forbidden", statusCode: 403 },
  { type: "StripeInvalidRequestError", code: "not_found", statusCode: 404 },
  { type: "StripePermissionError", code: "account_invalid", statusCode: 403 },
])("explains inaccessible stored accounts without replacing them: %j", async (error) => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  requireCompanyAdmin.mockResolvedValue({ id: "company-1" });
  stripe.v2.core.accountLinks.create.mockRejectedValue({ ...error, message: "private details", headers: { authorization: "secret" } });
  await expect(startStripeOnboarding("studio", new FormData())).rejects.toThrow("/settings?stripe=account_access_denied");
  expect(stripe.v2.core.accounts.create).not.toHaveBeenCalled();
  expect(db.company.updateMany).not.toHaveBeenCalled();
  expect(JSON.stringify(log.mock.calls)).not.toContain("private details");
  expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
});
it("distinguishes invalid credentials from missing account permissions", () => {
  expect(reportConnectError({ type: "StripeAuthenticationError", statusCode: 401 })).toBe("authentication_error");
});
