"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { EventFormState, EventFormValues } from "@/lib/events/validate-event";

interface Props {
  action: (state: EventFormState, formData: FormData) => Promise<EventFormState>;
  initialValues?: EventFormValues;
}

const emptyValues: EventFormValues = { name: "", beginsAt: "", endsAt: "", maxSeats: "" };
const fields = [
  { name: "name", label: "Name", type: "text" },
  { name: "beginsAt", label: "Beginn", type: "datetime-local", step: "0.001" },
  { name: "endsAt", label: "Ende", type: "datetime-local", step: "0.001" },
  { name: "maxSeats", label: "Maximale Plätze", type: "number", min: 1, max: 2147483647, step: "1" },
] as const;

export function EventForm({ action, initialValues = emptyValues }: Props) {
  const [state, formAction, pending] = useActionState(action, { values: initialValues });

  return (
    <form action={formAction} className="max-w-xl space-y-6">
      <p id="event-timezone" className="text-sm text-zinc-600 dark:text-zinc-400">
        Alle Zeiten gelten für Europe/Berlin. Doppelte Uhrzeiten bei der Herbstumstellung
        werden bei neuen Eingaben als erstes Auftreten (Sommerzeit) gespeichert.
        Unveränderte Zeitpunkte bleiben beim Bearbeiten erhalten.
      </p>
      <fieldset disabled={pending} className="space-y-5 disabled:opacity-60">
        {fields.map(({ name, label, ...attributes }) => (
          <div key={name}>
            <label htmlFor={name} className="mb-2 block font-medium">{label}</label>
            <input
              {...attributes}
              id={name}
              name={name}
              defaultValue={state.values[name]}
              required
              aria-invalid={Boolean(state.errors?.[name])}
              aria-describedby={[
                name === "beginsAt" || name === "endsAt" ? "event-timezone" : "",
                state.errors?.[name] ? `${name}-error` : "",
              ].filter(Boolean).join(" ") || undefined}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-950 focus:outline-2 focus:outline-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
            {state.errors?.[name] && <p id={`${name}-error`} className="mt-1 text-sm text-red-700 dark:text-red-400">{state.errors[name]}</p>}
          </div>
        ))}
      </fieldset>
      <p role="status" aria-live="polite" className="text-sm text-red-700 dark:text-red-400">{state.message}</p>
      <div className="flex items-center justify-end gap-4">
        <Link href="/events" className="rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-700">Abbrechen</Link>
        <button type="submit" disabled={pending} className="rounded-lg bg-zinc-900 px-4 py-2 text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
          {pending ? "Wird gespeichert …" : "Event speichern"}
        </button>
      </div>
    </form>
  );
}
