import Link from "next/link";
import { SiteFrame } from "@/components/site-frame";

export default function Home() {
  return (
    <SiteFrame>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center px-5 py-16 text-center sm:px-8">
        <p className="text-sm font-medium uppercase tracking-wide text-primary-700">
          Ein Angebot von Event Yoga
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          Willkommen bei Event Yoga
        </h1>
        <p className="mt-4 max-w-xl text-base text-zinc-600">
          Hier findest du unsere aktuellen Veranstaltungen.
        </p>
        <Link
          href="/events"
          className="mt-8 inline-flex rounded-lg bg-accent-500 px-5 py-3 font-semibold text-zinc-950 hover:bg-accent-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
        >
          Zu den Veranstaltungen
        </Link>
      </main>
    </SiteFrame>
  );
}
