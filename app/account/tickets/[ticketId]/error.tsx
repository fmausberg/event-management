"use client";
export default function TicketError({ reset }: { reset: () => void }) {
  return <main className="mx-auto max-w-xl p-6"><h1 className="text-2xl font-semibold">Dein Ticket</h1><p role="alert" className="mt-4">Ticket aktuell nicht verfügbar. Bitte später erneut versuchen.</p><button onClick={reset} className="mt-4 underline">Erneut versuchen</button></main>;
}
