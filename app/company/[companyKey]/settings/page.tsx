import { notFound, redirect } from "next/navigation";
import { refreshConnectAccount } from "@/lib/payments/connect";
import { startStripeOnboarding } from "./actions";
import { MemberAccessError, requireCompanyAdmin } from "@/lib/companies/members";
import { EmbedCode } from "./embed-code";
import { reportConnectError } from "@/lib/payments/connect-error";
export const dynamic = "force-dynamic";
export default async function CompanySettingsPage({ params, searchParams }: { params: Promise<{ companyKey: string }>; searchParams?: Promise<{ stripe?: string }> }) {
 const { companyKey } = await params;
 let company;
 try { company = await requireCompanyAdmin(companyKey); }
 catch (error) {
  if (error instanceof MemberAccessError) {
   if (error.reason === "UNAUTHENTICATED") redirect("/login");
   notFound();
  }
  throw error;
 }
 const configured = Boolean(process.env.STRIPE_SECRET_KEY);
 let connected = false, ready = false, failed = false;
 let statusError: ReturnType<typeof reportConnectError> | undefined;
 if (configured) {
  try {
   const status = await refreshConnectAccount(company.id);
   connected = Boolean(status.stripeAccountId);
   ready = status.stripeChargesEnabled && status.stripePayoutsEnabled;
  } catch (error) { failed = true; statusError = reportConnectError(error); }
 }
 const { stripe } = (await searchParams) ?? {};
 const connectionError = !stripe || stripe === "return" ? statusError : stripe;
 return <main className="flex-1 space-y-6 p-6 sm:p-10">
  <h1 className="text-2xl font-semibold">Einstellungen – {company.name}</h1>
  <EmbedCode slug={company.slug} companyName={company.name} />
  <section className="max-w-2xl space-y-4 rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
   <h2 className="text-xl font-semibold">Ticketzahlungen</h2>
   <p>Käufer bezahlen über Stripe. Die Zahlung geht direkt auf das Stripe-Konto deiner Company. Aktuell wird keine Plattformprovision erhoben.</p>
   <p role="status">{!configured ? "Stripe muss zuerst vom Plattformadministrator eingerichtet werden." : failed ? "Der Stripe-Status konnte gerade nicht geladen werden." : ready ? "Online-Zahlungen und Auszahlungen sind freigeschaltet." : connected ? "Bitte vervollständige die Einrichtung bei Stripe. Zahlungen sind noch nicht freigeschaltet." : "Verbinde deine Company mit Stripe, um kostenpflichtige Tickets anzubieten."}</p>
   {connectionError === "error" && <p role="alert" className="text-red-700">Stripe konnte nicht geöffnet werden. Bitte versuche es erneut.</p>}
   {connectionError === "account_access_denied" && <div role="alert" className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-950">
    <p>Das gespeicherte Stripe-Konto ist mit dem aktuell hinterlegten API-Schlüssel nicht zugänglich.</p>
    <p>Der Plattformadministrator muss prüfen, ob der Schlüssel zur richtigen Stripe-Plattform und zur selben Sandbox bzw. Live-Umgebung wie das verbundene Konto gehört und die benötigten Berechtigungen besitzt. Das Konto könnte auch entfernt worden sein.</p>
    <p>Nach einer Änderung des API-Schlüssels die Anwendung neu starten. Eine bestehende Kontozuordnung nicht ungeprüft ersetzen, da Zahlungen damit verknüpft sein können.</p>
   </div>}
   {connectionError === "authentication_error" && <p role="alert" className="text-red-700">Stripe akzeptiert den hinterlegten API-Schlüssel nicht. Bitte den Plattformadministrator bitten, die Stripe-Konfiguration zu prüfen.</p>}
   {connectionError === "connect_setup_required" && <div role="alert" className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-950">
    <p>Stripe Connect ist für die verwendete Stripe-Umgebung noch nicht aktiviert. Der Plattformadministrator muss zuerst die Connect-Einrichtung abschließen. Verwende dabei dieselbe Sandbox bzw. dasselbe Konto wie für den hinterlegten API-Schlüssel.</p>
    <a href="https://dashboard.stripe.com/settings/connect/platform-setup" target="_blank" rel="noopener noreferrer" className="block underline">Connect im Stripe-Dashboard einrichten</a>
    <p>Danach kannst du hier erneut auf „Stripe einrichten“ klicken.</p>
   </div>}
   {configured && <form action={startStripeOnboarding.bind(null, companyKey)} className="space-y-3">
    {!connected && <label className="block">Land des Unternehmens (zweistelliger Ländercode)<input name="country" defaultValue="DE" required minLength={2} maxLength={2} pattern="[A-Za-z]{2}" className="ml-3 w-20 rounded border border-zinc-300 p-2" /></label>}
    <button className="rounded-md bg-primary-700 px-4 py-2 text-white">{connected ? "Stripe-Einrichtung fortsetzen" : "Stripe einrichten"}</button>
   </form>}
   {connected && <a href="https://dashboard.stripe.com/" target="_blank" rel="noopener noreferrer" className="block underline">Zahlungen und Erstattungen bei Stripe verwalten</a>}
  </section>
 </main>;
}
