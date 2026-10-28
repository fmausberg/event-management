import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { TicketCard } from "@/components/ticket-card";
import { MemberAccessError } from "@/lib/companies/members";
import { getMyTicket } from "@/lib/tickets/account";
import { ResendTicketEmail } from "@/components/resend-ticket-email";
import { RefreshStatusButton } from "@/components/refresh-status-button";

export const metadata = { title: "Mein Ticket", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default async function MyTicketPage({ params }: { params: Promise<{ ticketId: string }> }) {
  const { ticketId } = await params;
  let ticket;
  try { ticket = await getMyTicket(ticketId); }
  catch (error) { if (error instanceof MemberAccessError && error.reason === "UNAUTHENTICATED") redirect("/login"); throw error; }
  if (!ticket) notFound();
  return <main className="mx-auto w-full max-w-xl px-5 py-10">
    <Link href="/account/bookings" className="text-sm underline underline-offset-4">← Meine Buchungen</Link>
    <div className="mt-6">
      <TicketCard ticket={ticket.ticket} bookingNumber={ticket.bookingNumber} qrCode={ticket.code ? { value: ticket.code } : null}>
        <RefreshStatusButton />
        <ResendTicketEmail ticketId={ticket.id} unavailableReason={ticket.resendUnavailableReason} />
      </TicketCard>
    </div>
  </main>;
}
