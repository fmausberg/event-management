"use client";

import { useRouter } from "next/navigation";
import type { VenueOption } from "@/lib/event-series/validation";
import type { TrainerOption } from "@/lib/trainers/validation";
import { SeriesForm } from "./series-table";

export function NewSeries({ slug, venues, trainers }: { slug: string; venues: VenueOption[]; trainers: TrainerOption[] }) {
  const router = useRouter();
  const base = `/company/${encodeURIComponent(slug)}/event-series`;
  return <details open className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
    <summary className="cursor-pointer rounded-xl p-4 font-semibold focus-visible:outline-2 focus-visible:outline-primary-600">Details</summary>
    <div className="border-t border-zinc-200 p-4 sm:p-6 dark:border-zinc-800">
      <SeriesForm inline slug={slug} venues={venues} trainers={trainers} onCancel={() => router.push(base)} onSaved={(_message, id) => { if (id) router.replace(`${base}/${encodeURIComponent(id)}`); }} />
    </div>
  </details>;
}
