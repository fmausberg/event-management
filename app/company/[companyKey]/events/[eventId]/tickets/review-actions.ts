"use server";
import { revalidatePath } from "next/cache";
import { resendReviewInvitation } from "@/lib/reviews/resend";
import { MemberAccessError } from "@/lib/companies/members";
export async function sendTicketReviewInvitation(slug: string, eventId: string, ticketId: string, requestId: string): Promise<{ queued?: boolean; message: string }> {
  try {
    const result = await resendReviewInvitation(slug, eventId, ticketId, requestId);
    revalidatePath(`/company/${encodeURIComponent(slug)}/events/${encodeURIComponent(eventId)}/tickets`);
    return result;
  } catch (error) {
    return { message: error instanceof MemberAccessError ? error.message : "Versand konnte nicht beauftragt werden. Bitte erneut versuchen." };
  }
}
