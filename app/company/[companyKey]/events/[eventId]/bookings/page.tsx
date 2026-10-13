import { notFound, redirect } from "next/navigation";
import { MemberAccessError } from "@/lib/companies/members";
import { getEventBookings } from "@/lib/bookings/management";
import { BookingsTable } from "./_components/bookings-table";
export default async function BookingsPage({ params }: { params: Promise<{ companyKey: string; eventId: string }> }) {
 const { companyKey, eventId } = await params;
 let result;
 try { result = await getEventBookings(companyKey, eventId); }
 catch (error) {
  if (error instanceof MemberAccessError) { if (error.reason === "UNAUTHENTICATED") redirect("/login"); notFound(); }
  return <main className="flex-1 p-6"><h1 className="text-2xl font-semibold">Bookings</h1><p role="alert" className="mt-4">Die Buchungen konnten gerade nicht geladen werden.</p><a href={`/company/${encodeURIComponent(companyKey)}/events/${encodeURIComponent(eventId)}/bookings`} className="mt-4 inline-block underline">Erneut versuchen</a></main>;
 }
 return <BookingsTable {...result} />;
}
