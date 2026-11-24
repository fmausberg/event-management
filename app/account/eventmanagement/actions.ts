"use server";

import { TaxError } from "@/lib/taxes/service";
import { auth } from "@/auth";

import { Prisma } from "@prisma/client";

import { revalidatePath } from "next/cache";

import { withSessionAudit } from "@/lib/audit/session";

import { respondToTrainerAssignment, TrainerConfirmationError } from "@/lib/trainers/confirmation";

import { deliverPendingCompanyNotifications } from "@/lib/tickets/outbox";

export type TrainerResponseState = { success?: boolean; message?: string };

export async function respondToEvent(assignmentId: string, _previous: TrainerResponseState, form: FormData): Promise<TrainerResponseState> {

  return withSessionAudit("account/eventmanagement.respondToEvent", async () => {

    const session = await auth();

    if (!session?.user?.id) return { message: "Bitte melde dich erneut an." };

    const response = form.get("response");

    if (response !== "ACCEPTED" && response !== "ISSUE") return { message: "Ungültige Rückmeldung." };

    try {

      await respondToTrainerAssignment(session.user.id, assignmentId, response, form.get("body"), form.get("requestId"));

    } catch (error) {

      if (error instanceof TaxError) return { message: "Die Veröffentlichung ist wegen einer unvollständigen Steuerkonfiguration noch nicht möglich. Bitte kontaktiere die Company; deine Antwort wurde noch nicht gespeichert." };
      if (error instanceof TrainerConfirmationError) return { message: error.message };

      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return { message: "Die Veranstaltung wurde gleichzeitig geändert. Bitte lade die Seite neu und versuche es erneut." };

      return { message: "Die Rückmeldung konnte nicht gespeichert werden. Bitte versuche es erneut." };

    }

    try { await deliverPendingCompanyNotifications(); } catch { /* Durable outbox retries independently. */ }

    revalidatePath("/account/eventmanagement");

    revalidatePath("/company/[companyKey]", "layout");

    revalidatePath("/events", "layout");

    revalidatePath("/admin/events");
    revalidatePath("/admin/audit");

    return { success: true, message: response === "ACCEPTED" ? "Deine Zusage wurde gespeichert." : "Dein Problem wurde gespeichert. Die Benachrichtigung der Company wurde beauftragt." };

  });

}

