import { notFound, redirect } from "next/navigation";
import { MemberAccessError, requireCompanyAdmin } from "@/lib/companies/members";
import { getPrisma } from "@/lib/db/prisma";
import { configuration, decrypt, errorCode, organizations, pending } from "@/lib/eventbrite/connection";
import { checkEventbrite, disconnectEventbrite, selectEventbriteOrganization, startEventbrite } from "./actions";

const messages: Record<string, string> = {
  config: "Eventbrite ist noch nicht vollständig eingerichtet. Bitte den Plattformadministrator kontaktieren.",
  session: "Bitte erneut anmelden und die Verbindung neu starten.",
  expired: "Die Einrichtung ist abgelaufen oder wurde bereits verwendet. Bitte erneut starten.",
  denied: "Die Freigabe bei Eventbrite wurde abgebrochen.",
  token: "Eventbrite akzeptiert die Freigabe nicht mehr. Bitte erneut autorisieren.",
  permission: "Der Eventbrite-Zugriff auf diese Organisation fehlt. Bitte die Berechtigungen prüfen und erneut autorisieren.",
  empty: "Für dieses Eventbrite-Konto sind keine Organisationen verfügbar.",
  provider: "Eventbrite konnte gerade nicht erreicht werden. Bitte später erneut versuchen.",
  conflict: "Diese Eventbrite-Organisation ist bereits mit einer anderen Company verbunden.",
};
export async function EventbriteSettingsSection({ companyKey, error }: {
  companyKey: string; error?: string;
}) {
  let company;
  try { company = await requireCompanyAdmin(companyKey); }
  catch (error) {
    if (error instanceof MemberAccessError) {
      if (error.reason === "UNAUTHENTICATED") redirect("/login");
      notFound();
    }
    throw error;
  }
  const connection = await getPrisma().eventbriteConnection.findUnique({ where: { companyId: company.id },
    select: { organizationId: true, organizationName: true, status: true } });
  let configured = true;
  try { configuration(); } catch { configured = false; }
  const flow = await pending(company.id);
  let choices: { id: string; name?: string | null }[] = [];
  let failure = error;
  if (flow?.encryptedAccessToken) {
    try {
      choices = await organizations(decrypt(flow.encryptedAccessToken, company.id));
      if (!choices.length) failure = "empty";
    } catch (error) { failure = errorCode(error); }
  }
  const button = "rounded-md bg-primary-700 px-4 py-2 text-white";
  return <section id="eventbrite" className="max-w-2xl space-y-4 rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
      <h2 className="text-xl font-semibold">Eventbrite</h2>
      <p>Verknüpfe eine bestehende Eventbrite-Organisation mit dieser Company.</p>
      <p role="status">{connection ? `Verbunden mit ${connection.organizationName || connection.organizationId}` : "Nicht verbunden"}</p>
      {connection?.status === "ERROR" && <p role="alert" className="text-red-700">Der Zugriff ist nicht mehr verfügbar. Bitte erneut autorisieren.</p>}
      {flow && <p role="status">Verbindung wird eingerichtet. {connection && "Die bisherige Verbindung bleibt bis zur bestätigten Auswahl erhalten."}</p>}
      {!configured && <p>Eventbrite muss zuerst vom Plattformadministrator eingerichtet werden.</p>}
      {failure && <p role="alert" className="text-red-700">{messages[failure] ?? messages.provider}</p>}
      {choices.length > 0 && <form action={selectEventbriteOrganization.bind(null, companyKey)} className="space-y-3">
        <label className="block">Eventbrite-Organisation
          <select name="organizationId" required defaultValue="" className="mt-2 block w-full rounded border border-zinc-300 p-2">
            <option value="" disabled>Bitte auswählen</option>
            {choices.map(org => <option key={org.id} value={org.id}>{org.name || "Organisation"} ({org.id})</option>)}
          </select>
        </label>
        <p>Bestätige die Organisation ausdrücklich. Eine bisherige Zuordnung wird dadurch ersetzt.</p>
        <button className={button}>Organisation verbindlich zuordnen</button>
      </form>}
      {configured && <form action={startEventbrite.bind(null, companyKey)}>
        <button className={button}>{connection ? "Erneut autorisieren / Organisation wechseln" : flow ? "Einrichtung neu starten" : "Mit Eventbrite verbinden"}</button>
      </form>}
      {connection && <form action={checkEventbrite.bind(null, companyKey)}><button className="underline">Verbindung prüfen</button></form>}
      {(connection || flow) && <form action={disconnectEventbrite.bind(null, companyKey)}>
        <button className="rounded-md border border-zinc-300 px-4 py-2">{connection ? "Eventbrite-Verbindung trennen" : "Einrichtung abbrechen"}</button>
      </form>}
    </section>;
}
