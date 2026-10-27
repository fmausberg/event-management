import { notFound, redirect } from "next/navigation";
import { MemberAccessError } from "@/lib/companies/members";
import { getCompanyCancellations } from "@/lib/cancellations/data";
import { requestLabels, refundLabels } from "@/lib/cancellations/policy";
import { CancellationActionForm } from "@/components/cancellation-action-form";
import { RefreshStatusButton } from "@/components/refresh-status-button";

export default async function CancellationsPage({ params }: { params: Promise<{ companyKey: string }> }) {
  const { companyKey } = await params;
  let result;
  try { result = await getCompanyCancellations(companyKey); }
  catch (error) { if (error instanceof MemberAccessError) { if (error.reason === "UNAUTHENTICATED") redirect("/login"); notFound(); } throw error; }
  const date = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" });
  const pending = result.requests.filter((r) => r.status === "PENDING");
  return <main className="flex min-w-0 flex-1 flex-col gap-6 bg-zinc-50 p-6 sm:p-10 dark:bg-black">
    <header><h1 className="text-2xl font-semibold">Stornierungen</h1><p className="text-sm text-zinc-500">{result.company.name} · {pending.length} offene Anfragen · Zeiten in Europe/Berlin</p></header>
    <RefreshStatusButton />
    {[{ title: "Offene Anfragen", rows: pending }, { title: "Verlauf und Erstattungen", rows: result.requests.filter((r) => r.status !== "PENDING") }].map((group) => <section key={group.title}>
      <h2 className="mb-3 text-lg font-semibold">{group.title}</h2>
      {!group.rows.length && <p className="text-sm text-zinc-500">Keine Einträge.</p>}
      <div className="space-y-4">{group.rows.map((request) => <article key={request.id} className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <h3 className="font-semibold">{request.booking.event.name} · Buchung #{request.booking.number}</h3>
        <p className="text-sm">{request.booking.customerName} · {request.booking.customerEmail} · {request.booking.quantity} Platz/Plätze</p>
        <p className="mt-2 text-sm">{requestLabels[request.status]}{request.automatic ? " (kostenfreie Selbststornierung)" : ""}</p>
        <p className="text-sm">Eingang: {date.format(request.requestedAt)} · Eventbeginn: {request.booking.event.beginsAt ? date.format(request.booking.event.beginsAt) : "Noch offen"}</p>
        {request.decidedAt && <p className="text-sm">Bearbeitet: {date.format(request.decidedAt)} · {request.decidedBy?.name ?? request.decidedBy?.email ?? "Gelöschtes Konto"}</p>}
        {request.customerReason && <p className="mt-2 whitespace-pre-wrap text-sm">Kundenhinweis: {request.customerReason}</p>}
        {request.internalNote && <p className="mt-2 whitespace-pre-wrap text-sm">Interne Notiz: {request.internalNote}</p>}
        {request.status === "APPROVED" && <><p className="mt-2 font-medium">{refundLabels[request.refundStatus]}</p>{request.refundError && <p className="text-sm text-red-700">{request.refundError}</p>}</>}
        {request.booking.payment && <p className="text-sm">Onlinezahlung: {(request.booking.payment.amount / 100).toFixed(2)} {request.booking.payment.currency} · {request.booking.payment.status}</p>}
        {request.status === "PENDING" && <CancellationActionForm id={request.id} intent="decide" label="Ausgewählte Entscheidung" noteLabel="Interne Notiz (optional)" />}
        {request.status === "APPROVED" && ["PENDING", "FAILED", "REVIEW"].includes(request.refundStatus) && <CancellationActionForm id={request.id} intent="retry" label={request.refundStatus === "FAILED" ? "Erstattung erneut anstoßen" : "Erstattungsstatus erneut prüfen"} />}
      </article>)}</div>
    </section>)}
  </main>;
}
