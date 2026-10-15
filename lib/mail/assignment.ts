import "server-only";
import { auth } from "@/auth";
import { getPrisma } from "@/lib/db/prisma";
import { requireCompanyAccess } from "@/lib/companies/members";
import { consumeAuthAttempt } from "@/lib/auth/rate-limit";
import { accountOrigin } from "@/lib/auth/verification";
import { sendMail } from "@/lib/mail";
import { assignmentNotification } from "./templates/assignment";
import { findUserByEmail } from "@/lib/auth/users";

export type AssignmentKind = "event" | "venue" | "trainer" | "member";
export async function notifyAssignment(kind: AssignmentKind, slug: string, id: string) {
  try {
    const { company } = await requireCompanyAccess(slug, kind === "member");
    const db = getPrisma();
    let email: string | null = null;
    let role = "";
    let scope = "";
    let eventId: string | undefined;
    let actorId = (await auth())?.user?.id;
    if (kind === "event") {
      const row = await db.eventStaff.findFirst({ where: { id, event: { companyId: company.id } }, include: { event: { select: { name: true } } } });
      if (!row) throw new Error("Missing assignment");
      email = row.email; role = "Event-Staff"; scope = row.event.name; actorId = row.assignedById;
      eventId = row.eventId;
    } else if (kind === "venue") {
      const row = await db.venueStaff.findFirst({ where: { id, venue: { companyId: company.id } }, include: { venue: { select: { name: true } } } });
      if (!row) throw new Error("Missing assignment");
      email = row.email; role = "Venue-Staff"; scope = row.venue.name; actorId = row.assignedById;
    } else if (kind === "trainer") {
      const row = await db.trainer.findFirst({ where: { id, companyId: company.id } });
      if (!row) throw new Error("Missing assignment");
      email = row.email; role = "Trainer";
    } else if (kind === "member") {
      const row = await db.companyMembership.findFirst({ where: { id, companyId: company.id } });
      if (!row) throw new Error("Missing assignment");
      email = row.email; role = row.role === "COMPANY_ADMIN" ? "Company-Admin" : "Company-User";
    } else throw new Error("Invalid kind");
    if (!email || !actorId) throw new Error("Missing recipient");
    const actor = await db.user.findUnique({ where: { id: actorId }, select: { name: true, email: true } });
    if (!actor) throw new Error("Missing actor");
    if (!await consumeAuthAttempt(`${actorId}:${kind}:${id}`, "assignment-mail")) return { success: false, message: "Bitte warte 15 Minuten, bevor du die Benachrichtigung erneut sendest." };
    const origin = accountOrigin();
    const recipient = await findUserByEmail(email);
    await sendMail({ to: email, ...assignmentNotification({
      actorName: actor.name || actor.email, companyName: company.name, role, scope,
      accountStatus: !recipient ? "missing" : recipient.emailVerified ? "verified" : "unverified",
      eventUrl: eventId ? `${origin}/company/${encodeURIComponent(slug)}/events/${encodeURIComponent(eventId)}/tickets` : undefined,
      registrationUrl: `${origin}/register`, verificationUrl: `${origin}/verify-email`,
      myEventsUrl: kind === "venue" ? `${origin}/account/events` : undefined,
    }) });
    return { success: true, message: "Benachrichtigung wurde gesendet." };
  } catch {
    return { success: false, message: "Die Zuordnung bleibt gespeichert. Die Benachrichtigung konnte nicht gesendet werden; bitte erneut versuchen." };
  }
}
