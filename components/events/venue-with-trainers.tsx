export function VenueWithTrainers({ venue, trainers }: { venue: string; trainers?: string | null }) {
  return <>{venue}<div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">({trainers?.trim() || "tbd"})</div></>;
}

export function VenueTrainerHeading() {
  return <span>Ort<br /><span>(Trainer)</span></span>;
}
