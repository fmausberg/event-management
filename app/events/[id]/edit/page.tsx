import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getEvent } from "@/lib/events/get-event";
import { formatBerlinDateTime } from "@/lib/events/berlin-date-time";
import { updateEvent } from "../../actions";
import { EventForm } from "../../_components/event-form";

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const event = await getEvent(id);
  if (!event) notFound();

  return (
    <main className="flex flex-1 flex-col bg-zinc-50 px-6 py-12 text-zinc-950 sm:px-16 dark:bg-black dark:text-zinc-50">
      <h1 className="mb-6 text-2xl font-semibold">Event bearbeiten</h1>
      <EventForm action={updateEvent.bind(null, event.id)} initialValues={{
        name: event.name,
        beginsAt: formatBerlinDateTime(event.beginsAt),
        endsAt: formatBerlinDateTime(event.endsAt),
        maxSeats: String(event.maxSeats),
      }} />
    </main>
  );
}
