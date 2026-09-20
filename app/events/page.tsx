import { connection } from "next/server";
import { getEventsWithCapacity } from "@/lib/events/get-events-with-capacity";

const dateFormatter = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Berlin",
});

export default async function EventsPage() {
  // Do not access the database while building/prerendering the application.
  await connection();
  const events = await getEventsWithCapacity();

  return (
    <main className="flex flex-1 flex-col bg-zinc-50 px-6 py-12 sm:px-16 dark:bg-black">
      <h1 className="mb-6 text-2xl font-semibold text-black dark:text-zinc-50">Events</h1>
      {events.length === 0 ? (
        <p className="rounded-lg border border-zinc-200 p-6 text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          Noch keine Events vorhanden. Sobald ein Event angelegt wurde, erscheint hier seine Kapazität.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Events und aktuelle Platzkapazitäten. Zeiten in Europe/Berlin.</caption>
            <thead className="bg-zinc-100 dark:bg-zinc-900">
              <tr>
                {["Nummer", "Name", "Beginn", "Ende", "Maximale Plätze", "Gebuchte Plätze", "Freie Plätze"].map((label) => (
                  <th key={label} scope="col" className="px-4 py-3 font-medium text-zinc-600 dark:text-zinc-400">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-t border-zinc-200 text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
                  <td className="px-4 py-3">{event.number}</td>
                  <th scope="row" className="px-4 py-3 font-medium text-black dark:text-zinc-50">{event.name}</th>
                  <td className="whitespace-nowrap px-4 py-3"><time dateTime={event.beginsAt.toISOString()}>{dateFormatter.format(event.beginsAt)}</time></td>
                  <td className="whitespace-nowrap px-4 py-3"><time dateTime={event.endsAt.toISOString()}>{dateFormatter.format(event.endsAt)}</time></td>
                  <td className="px-4 py-3">{event.maxSeats}</td>
                  <td className="px-4 py-3">{event.confirmedSeats}</td>
                  <td className="px-4 py-3">{event.remainingSeats}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
