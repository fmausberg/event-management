import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MemberAccessError } from "@/lib/companies/members";
import { getCompanyEvents } from "@/lib/company-events/data";
import { EventsTable } from "../../events/_components/events-table";

export default async function CompanyEventSeriesDetailPage({ params }: {
  params: Promise<{ companyKey: string; seriesId: string }>;
}) {
  const { companyKey, seriesId } = await params;
  let result;
  try {
    result = await getCompanyEvents(companyKey, seriesId);
  } catch (error) {
    if (error instanceof MemberAccessError) {
      if (error.reason === "UNAUTHENTICATED") redirect("/login");
      notFound();
    }
    return <main className="flex-1 p-6 sm:p-10">
      <h1 className="text-2xl font-semibold">Eventserie</h1>
      <p role="alert" className="mt-4">Die Eventserie konnte gerade nicht geladen werden.</p>
      <Link href={`/company/${encodeURIComponent(companyKey)}/event-series/${encodeURIComponent(seriesId)}`} className="mt-4 inline-block underline">Erneut versuchen</Link>
    </main>;
  }
  const series = result.series.find((row) => row.id === seriesId);
  if (!series) notFound();
  const trainer = result.trainers.find((row) => row.id === series.suggestedTrainerId);
  const details = [
    ["Nummer", series.number],
    ["Dauer (Vorgabe)", series.suggestedDuration ? `${series.suggestedDuration} Minuten` : "—"],
    ["Venue (Vorgabe)", result.venues.find((row) => row.id === series.suggestedVenueId)?.name ?? "—"],
    ["Trainer (Vorgabe)", trainer ? `${trainer.firstName} ${trainer.lastName}` : series.suggestedTrainerName ?? "—"],
    ["Teilnehmerzahl (Vorgabe)", series.suggestedMaxSeats ?? "—"],
    ["Ticketpreis (Vorgabe)", series.suggestedTicketPrice === null ? "—" : `${series.suggestedTicketPrice.replace(".", ",")} ${series.suggestedCurrency}`],
    ["Events", result.events.length],
  ];
  return <EventsTable {...result} defaultSeriesId={series.id} seriesDetails={<>
    <Link href={`/company/${encodeURIComponent(result.company.slug)}/event-series`} className="self-start text-sm text-primary-700 underline dark:text-primary-300">← Zurück zu den Eventserien</Link>
    <section aria-labelledby="series-title" className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
      <h1 id="series-title" className="text-2xl font-semibold">{series.name}</h1>
      <p className="mt-1 text-sm text-zinc-500">{result.company.name}</p>
      {series.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={series.imageUrl} alt={`Titelbild: ${series.name}`} className="mt-6 aspect-video w-full max-w-xl rounded-lg object-cover" />
      )}
      <dl className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <div className="sm:col-span-2 lg:col-span-3"><dt className="text-sm text-zinc-500">Kurzbeschreibung</dt><dd className="mt-1 whitespace-pre-wrap break-words">{series.shortdescription || "—"}</dd></div>
        <div className="sm:col-span-2 lg:col-span-3"><dt className="text-sm text-zinc-500">Beschreibung</dt><dd className="mt-1 whitespace-pre-wrap break-words">{series.description || "—"}</dd></div>
        {details.map(([label, value]) => <div key={label}><dt className="text-sm text-zinc-500">{label}</dt><dd className="mt-1">{value}</dd></div>)}
      </dl>
    </section>
  </>} />;
}
