import Link from "next/link";
import { SiteFrame } from "@/components/site-frame";
export default function Home() {
  return <SiteFrame>
    <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-12 sm:px-8">
      <h1 className="text-2xl font-semibold">Homepage</h1>
      <Link href="/events" className="mt-6 inline-flex rounded-lg bg-accent-500 px-5 py-3 font-semibold text-zinc-950 hover:bg-accent-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600">
        Zu den Veranstaltungen
      </Link>
    </main>
  </SiteFrame>;
}
