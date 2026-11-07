"use client";

import { useRouter } from "next/navigation";
import type { SeriesRow, VenueOption } from "@/lib/event-series/validation";
import type { TrainerOption } from "@/lib/trainers/validation";
import { EventForm } from "./events-table";

export function NewEvent({ slug, series, venues, trainers, defaultSeries }: { slug: string; series: SeriesRow[]; venues: VenueOption[]; trainers: TrainerOption[]; defaultSeries?: SeriesRow }) {
  const router = useRouter();
  const base = `/company/${encodeURIComponent(slug)}/events`;
  return <details open className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
    <summary className="cursor-pointer rounded-xl p-4 font-semibold focus-visible:outline-2 focus-visible:outline-primary-600">Details</summary>
    <div className="min-w-0 border-t border-zinc-200 p-4 sm:p-6 dark:border-zinc-800">
      <EventForm key={defaultSeries?.id ?? "new"} inline slug={slug} defaultSeries={defaultSeries} series={series} venues={venues} trainers={trainers} onCancel={() => router.push(base)} onSaved={(_message, id) => router.replace(id ? `${base}/${encodeURIComponent(id)}` : base)} />
    </div>
  </details>;
}
