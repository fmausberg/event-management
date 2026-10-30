import { notFound, redirect } from "next/navigation";
import { MemberAccessError } from "@/lib/companies/members";
import { getReviewSummary } from "@/lib/reviews/management";

export default async function ReviewsPage({ params }: { params: Promise<{ companyKey: string; eventId: string }> }) {
  const { companyKey, eventId } = await params;
  let data;
  try { data = await getReviewSummary(companyKey, eventId); }
  catch (error) {
    if (error instanceof MemberAccessError) { if (error.reason === "UNAUTHENTICATED") redirect("/login"); notFound(); }
    throw error;
  }
  return <main className="mx-auto w-full max-w-3xl flex-1 p-6">
    <a className="underline" href={`/company/${encodeURIComponent(companyKey)}/events`}>Zur Eventverwaltung</a>
    <h1 className="my-6 text-2xl font-semibold">Bewertungen: {data.event.name}</h1>
    <dl className="grid grid-cols-2 gap-4">
      {[["Einladungen erstellt", data.invited], ["Einladungen versendet", data.sent], ["Vorläufig", data.provisional], ["Abgeschlossen", data.completed]].map(([label, value]) => <div className="rounded-lg border p-4" key={label}><dt>{label}</dt><dd className="text-2xl font-semibold">{value}</dd></div>)}
    </dl>
    <p className="my-5">Durchschnittswerte berücksichtigen ausschließlich abgeschlossene Bewertungen. Nicht bewertete Kategorien zählen nicht mit.</p>
    <div className="overflow-x-auto"><table className="w-full text-left">
      <caption className="sr-only">Interne Auswertung abgeschlossener Bewertungen</caption>
      <thead><tr><th className="p-3">Kategorie</th><th className="p-3">Durchschnitt / 5</th><th className="p-3">Antworten</th></tr></thead>
      <tbody>{([["overallRating", "Gesamt"], ["trainerRating", "Trainer"], ["locationRating", "Location"], ["organizationRating", "Organisation und Kommunikation"]] as const).map(([key, label]) => <tr className="border-t" key={key}><th className="p-3">{label}</th><td className="p-3">{data.scores._avg[key]?.toLocaleString("de-DE", { maximumFractionDigits: 2 }) ?? "Nicht bewertet"}</td><td className="p-3">{data.scores._count[key]}</td></tr>)}</tbody>
    </table></div>
  </main>;
}
