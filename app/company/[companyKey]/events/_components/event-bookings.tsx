import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MemberAccessError } from "@/lib/companies/members";
import { getEventBookings } from "@/lib/bookings/management";
import { getNoteSummaries } from "@/lib/notes/service";
import { BookingsTable } from "../[eventId]/bookings/_components/bookings-table";

export async function EventBookings({ slug, eventId }: { slug: string; eventId: string }) {
  let content;
  try {
    const result = await getEventBookings(slug, eventId);
    const noteSummaries = await getNoteSummaries("booking", result.bookings.map(row => row.id));
    content = <BookingsTable embedded {...result} noteSummaries={noteSummaries} />;
  } catch (error) {
    if (error instanceof MemberAccessError) {
      if (error.reason === "UNAUTHENTICATED") redirect("/login");
      notFound();
    }
    content = <p role="alert" className="text-sm">Die Buchungen konnten gerade nicht geladen werden. <Link className="underline" href={`/company/${encodeURIComponent(slug)}/events/${encodeURIComponent(eventId)}#event-bookings`}>Erneut versuchen</Link></p>;
  }
  return <details id="event-bookings" className="scroll-mt-20 rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
    <summary className="cursor-pointer rounded-xl p-4 font-semibold focus-visible:outline-2 focus-visible:outline-primary-600">Buchungen</summary>
    <div className="min-w-0 border-t border-zinc-200 p-4 sm:p-6 dark:border-zinc-800">{content}</div>
  </details>;
}
