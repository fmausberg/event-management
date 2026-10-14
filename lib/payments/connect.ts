import "server-only";
import { getPrisma } from "@/lib/db/prisma";
import { getStripe, paymentOrigin } from "./stripe";

export async function refreshConnectAccount(companyId: string) {
  const db = getPrisma();
  const company = await db.company.findUniqueOrThrow({ where: { id: companyId } });
  if (!company.stripeAccountId) return company;
  const account = await getStripe().v2.core.accounts.retrieve(company.stripeAccountId, { include: ["configuration.merchant"] });
  const capabilities = account.configuration?.merchant?.capabilities;
  return db.company.update({ where: { id: companyId }, data: {
    stripeChargesEnabled: capabilities?.card_payments?.status === "active",
    stripePayoutsEnabled: capabilities?.stripe_balance?.payouts?.status === "active",
  } });
}

export async function connectOnboarding(companyId: string, country?: string) {
  const db = getPrisma();
  let company = await db.company.findUniqueOrThrow({ where: { id: companyId } });
  const stripe = getStripe();
  if (!company.stripeAccountId) {
    if (!country || !/^[A-Z]{2}$/.test(country)) throw new Error("Bitte das Land des Unternehmens angeben.");
    // Stable request parameters and key also cover concurrent admin clicks.
    const account = await stripe.v2.core.accounts.create({
      identity: { country },
      dashboard: "full",
      configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
      defaults: { responsibilities: { fees_collector: "stripe", losses_collector: "stripe" } },
      metadata: { companyId },
    }, { idempotencyKey: `company-connect-${companyId}` });
    await db.company.updateMany({ where: { id: companyId, stripeAccountId: null }, data: { stripeAccountId: account.id } });
    company = await db.company.findUniqueOrThrow({ where: { id: companyId } });
  }
  const path = `/company/${encodeURIComponent(company.slug)}/settings`;
  const link = await stripe.v2.core.accountLinks.create({
    account: company.stripeAccountId!,
    use_case: { type: "account_onboarding", account_onboarding: {
      refresh_url: `${paymentOrigin()}${path}/stripe-refresh`,
      return_url: `${paymentOrigin()}${path}?stripe=return`,
    } },
  });
  return link.url;
}
