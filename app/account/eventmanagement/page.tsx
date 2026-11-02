import Link from "next/link";
import { getMyEvents } from "@/lib/account/events";
import { groupAssignedEvents } from "@/lib/account/events-presentation";

export const metadata = { title: "Event Management" };
const eventStatuses = { DRAFT: "Entwurf", PUBLISHED: "Veröffentlicht", CANCELLED: "Abgesagt", COMPLETED: "Abgeschlossen" };
const statusColors = { DRAFT: "bg-yellow-100 text-yellow-800", PUBLISHED: "bg-green-100 text-green-800", CANCELLED: "bg-red-100 text-red-800", COMPLETED: "bg-zinc-200 text-zinc-700" };

export default async function MyEventsPage() {
  const events = await getMyEvents();
  const groups = groupAssignedEvents(events);
  const date = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" });
  return <main className="flex min-w-0 flex-1 flex-col gap-6 bg-zinc-50 p-6 sm:p-10 dark:bg-black">
    <header><p className="mb-1 text-xs text-zinc-500">Account / Event Management</p><h1 className="text-2xl font-semibold">Event Management</h1><p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Veranstaltungen, denen du als Event-Staff, Venue-Staff oder Trainer zugeordnet bist.</p></header>
    <Link href="/account/bookings" className="self-start text-primary-700 underline dark:text-primary-300">Deine eigenen Buchungen und Tickets findest du unter „Meine Buchungen“.</Link>
    {!events.length ? <p className="rounded-xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">Hier erscheinen Veranstaltungen, denen du als Event-Staff, Venue-Staff oder Trainer zugeordnet bist, sobald sie veröffentlicht sind. Abgesagte und abgeschlossene Veranstaltungen bleiben sichtbar.</p> : [
      { title: "Kommende Events", items: groups.upcoming, open: true, empty: "Keine kommenden Events zugeordnet." },
      { title: "Vergangene Events", items: groups.past, open: false, empty: "Keine vergangenen Events zugeordnet." },
    ].map(group => <details key={group.title} open={group.open} className="space-y-4" aria-label={group.title}>
      <summary className="cursor-pointer rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4"><h2 className="inline-flex items-center gap-3 text-lg font-semibold">{group.title}<span className="rounded-full bg-zinc-200 px-2.5 py-0.5 text-xs dark:bg-zinc-800">{group.items.length}</span></h2></summary>
      {!group.items.length ? <p className="text-sm text-zinc-500">{group.empty}</p> : <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Event Management und Rollen – {group.title}</caption>
        <thead className="bg-zinc-100 dark:bg-zinc-900"><tr>{["Veranstaltung", "Beginn (Europe/Berlin)", "Company", "Ort", "Status", "Meine Rolle", "Aktionen"].map((label) => <th key={label} scope="col" className="px-4 py-3">{label}</th>)}</tr></thead>
        <tbody>{group.items.map((event) => <tr key={event.id} className="border-t border-zinc-200 align-top dark:border-zinc-800">
          <th scope="row" className="px-4 py-4 font-medium">{event.status === "PUBLISHED" ? <Link href={`/events/${encodeURIComponent(event.company.slug)}/${encodeURIComponent(event.id)}`} className="text-primary-700 underline dark:text-primary-300">{event.name}</Link> : event.name}</th>
          <td className="whitespace-nowrap px-4 py-4">{event.beginsAt ? date.format(event.beginsAt) : "Noch offen"}</td>
          <td className="px-4 py-4">{event.company.name}</td>
          <td className="px-4 py-4">{event.venueName ?? "Noch kein Ort"}</td>
          <td className="px-4 py-4"><span className={`inline-flex whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${statusColors[event.status]}`}>{eventStatuses[event.status]}</span></td>
          <td className="px-4 py-4"><div className="flex flex-wrap gap-2">{event.roles.map((role) => <span key={role} className="whitespace-nowrap rounded-full bg-primary-100 px-2.5 py-1 text-xs font-medium text-primary-800 dark:bg-primary-950 dark:text-primary-200">{role}</span>)}</div></td>
          <td className="px-4 py-4"><Link href={`/company/${encodeURIComponent(event.company.slug)}/events/${encodeURIComponent(event.id)}/tickets`} className="inline-block whitespace-nowrap rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700">Ticketverwaltung</Link></td>
        </tr>)}</tbody>
      </table>
    </div>}
    </details>)}
  </main>;
}
