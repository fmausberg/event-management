import { createEvent } from "../actions";
import { EventForm } from "../_components/event-form";

export default function NewEventPage() {
  return (
    <main className="flex flex-1 flex-col bg-zinc-50 px-6 py-12 text-zinc-950 sm:px-16 dark:bg-black dark:text-zinc-50">
      <h1 className="mb-6 text-2xl font-semibold">Event erstellen</h1>
      <EventForm action={createEvent} />
    </main>
  );
}
