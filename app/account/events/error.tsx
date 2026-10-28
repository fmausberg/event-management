"use client";

export default function MyEventsError({ reset }: { reset: () => void }) {
  return <main className="flex-1 p-6 sm:p-10"><h1 className="text-2xl font-semibold">Check-In Management</h1><p role="alert" className="mt-4">Deine Veranstaltungen konnten gerade nicht geladen werden.</p><button type="button" onClick={reset} className="mt-4 underline">Erneut versuchen</button></main>;
}
