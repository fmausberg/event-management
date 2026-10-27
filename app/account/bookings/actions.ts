"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MemberAccessError } from "@/lib/companies/members";
import { CancellationError, requestCancellation, decideCancellation } from "@/lib/cancellations/service";
import { processCancellationRefund, retryCancellationRefund } from "@/lib/cancellations/refunds";
import { deliverCancellationMails } from "@/lib/cancellations/mail";

export type CancellationState = { success?: boolean; message?: string };
export async function cancellationAction(_previous: CancellationState, form: FormData): Promise<CancellationState> {
  try {
    const id = z.string().min(1).max(191).parse(form.get("id"));
    const action = z.enum(["free", "request", "withdraw", "approve", "reject", "retry"]).parse(form.get("intent"));
    const note = z.string().max(2000).parse(form.get("note") ?? "");
    if (form.get("confirmed") !== "yes") return { message: "Bitte bestätige die Aktion." };
    if (action === "free" || action === "request") {
      const request = await requestCancellation(id, note, action);
      if (request.status === "APPROVED") await processCancellationRefund(request.id);
    } else if (action === "retry") await retryCancellationRefund(id);
    else {
      await decideCancellation(id, action === "approve" ? "APPROVED" : action === "reject" ? "REJECTED" : "WITHDRAWN", note);
      if (action === "approve") await processCancellationRefund(id);
    }
  } catch (error) {
    if (error instanceof MemberAccessError || error instanceof CancellationError) return { message: error.message };
    if (error instanceof z.ZodError) return { message: "Bitte prüfe deine Eingaben (Hinweis maximal 2000 Zeichen)." };
    console.error("Cancellation action failed");
    return { message: "Der Vorgang konnte nicht abgeschlossen werden. Lade die Seite neu und prüfe den gespeicherten Status, bevor du es erneut versuchst." };
  }
  for (const path of ["/account", "/account/bookings", "/account/events", "/events"]) revalidatePath(path);
  revalidatePath("/company/[companyKey]", "layout");
  revalidatePath("/events/[companySlug]/[eventId]", "page");
  let mailFailed = false;
  try { mailFailed = (await deliverCancellationMails()) > 0; }
  catch { mailFailed = true; console.error("Cancellation mail dispatch failed"); }
  return { success: true, message: `Vorgang gespeichert. Den aktuellen Buchungs- und Erstattungsstatus findest du oben.${mailFailed ? " Eine Benachrichtigung konnte noch nicht versendet werden und wird erneut versucht." : ""}` };
}
