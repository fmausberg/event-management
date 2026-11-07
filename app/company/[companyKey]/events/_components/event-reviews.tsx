import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EventReviewSummary } from "@/components/event-review-summary";
import { MemberAccessError } from "@/lib/companies/members";
import { getReviewSummary } from "@/lib/reviews/management";

export async function EventReviews({ slug, eventId }: { slug: string; eventId: string }) {
  let content;
  try {
    const data = await getReviewSummary(slug, eventId);
    content = <EventReviewSummary data={data} />;
  } catch (error) {
    if (error instanceof MemberAccessError) {
      if (error.reason === "UNAUTHENTICATED") redirect("/login");
      notFound();
    }
    content = <p role="alert" className="text-sm">Die Bewertungen konnten gerade nicht geladen werden. <Link className="underline" href={`/company/${encodeURIComponent(slug)}/events/${encodeURIComponent(eventId)}#event-reviews`}>Erneut versuchen</Link></p>;
  }
  return <details id="event-reviews" className="scroll-mt-20 rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
    <summary className="cursor-pointer rounded-xl p-4 font-semibold focus-visible:outline-2 focus-visible:outline-primary-600">Bewertungen</summary>
    <div className="min-w-0 border-t border-zinc-200 p-4 sm:p-6 dark:border-zinc-800">{content}</div>
  </details>;
}
