import { EventReviewSummary } from "@/components/event-review-summary";
import { notFound, redirect } from "next/navigation";
import { MemberAccessError } from "@/lib/companies/members";
import { getReviewSummary } from "@/lib/reviews/management";

export default async function ReviewsPage({ params }: { params: Promise<{ companyKey: string; eventId: string }> }) {
  const { companyKey, eventId } = await params;
  let data;
  try { data = await getReviewSummary(companyKey, eventId); }
  catch (error) {
    if (error instanceof MemberAccessError) { if (error.reason === "UNAUTHENTICATED") redirect("/login"); notFound(); }
    throw error;
  }
  return <main className="mx-auto w-full max-w-3xl flex-1 p-6">
    <a className="underline" href={`/company/${encodeURIComponent(companyKey)}/events`}>Zur Veranstaltungsverwaltung</a>
    <h1 className="my-6 text-2xl font-semibold">Bewertungen: {data.event.name}</h1>
    <EventReviewSummary data={data} />
  </main>;
}
