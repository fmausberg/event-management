"use server";
import { withSessionAudit } from "@/lib/audit/session";
import { revalidatePath } from "next/cache";
import { synchronizeTrainerConfirmation } from "@/lib/trainers/confirmation";
import { queueVenueConfirmations } from "@/lib/venues/confirmation";
import { deliverPendingVenueConfirmations } from "@/lib/tickets/outbox";
import { Prisma } from "@prisma/client";
import { notifyAssignment } from "@/lib/mail/assignment";
import { auth } from "@/auth";
import { requireCompanyAccess, MemberAccessError } from "@/lib/companies/members";
import { getPrisma } from "@/lib/db/prisma";
import { emailSchema } from "@/lib/auth/validation";

async function access(slug: string, venueId: string) {
 const { company } = await requireCompanyAccess(slug);
 const db = getPrisma();
 if (!await db.venue.findFirst({ where: { id: venueId, companyId: company.id }, select: { id: true } })) throw new Error("VENUE_NOT_FOUND");
 return db;
}
function failure(error: unknown) {
 if (error instanceof MemberAccessError) return error.message;
 if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "Diese E-Mail-Adresse ist bereits zugeordnet.";
 return "Ortsteam konnte nicht geladen oder gespeichert werden. Bitte versuche es erneut.";
}
export async function listVenueStaff(slug: string, venueId: string) {
 try {
  const db = await access(slug, venueId);
  const rows = await db.venueStaff.findMany({ where: { venueId }, select: { id: true, email: true, user: { select: { email: true, emailVerified: true } } } });
  const emails = rows.filter((row) => !row.user && row.email).map((row) => row.email!);
  const accounts = emails.length ? await db.user.findMany({ where: { email: { in: emails, mode: "insensitive" } }, select: { email: true, emailVerified: true } }) : [];
  const staff = rows.map((row) => {
   const matches = accounts.filter((account) => account.email.toLowerCase() === row.email?.toLowerCase());
   const account = row.user ?? (matches.length === 1 ? matches[0] : null);
   return { id: row.id, email: row.user?.email ?? row.email ?? "—", status: account ? account.emailVerified ? "verified" : "not verified" : "no account" };
  }).sort((a, b) => a.email.localeCompare(b.email, "de", { sensitivity: "base" }) || a.id.localeCompare(b.id));
  return { staff };
 } catch (error) { return { message: failure(error) }; }
}
export async function addVenueStaff(slug: string, venueId: string, email: string) {
 try {
  const db = await access(slug, venueId);
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return { message: parsed.error.issues[0].message };
  const actor = (await auth())?.user?.id;
  if (!actor) throw new MemberAccessError("UNAUTHENTICATED");
  const users = await db.user.findMany({ where: { email: { equals: parsed.data, mode: "insensitive" } }, select: { id: true, emailVerified: true } });
  if (users.length > 1) return { message: "Die E-Mail-Adresse ist keinem eindeutigen Account zugeordnet." };
  const assignment = await db.venueStaff.create({ data: { venueId, email: parsed.data, userId: users[0]?.emailVerified ? users[0].id : null, assignedById: actor } });
  const notification = await notifyAssignment("venue", slug, assignment.id);
  const pending = await db.event.findMany({ where: { venueId, status: "PENDING_VENUE_CONFIRMATION" }, select: { id: true } });
  await db.$transaction(tx => queueVenueConfirmations(tx, pending.map(event => event.id)));
  await deliverPendingVenueConfirmations();
  revalidatePath("/account/eventmanagement");
  return { success: true, message: notification.message };
 } catch (error) { return { message: failure(error) }; }
}
export async function removeVenueStaff(slug: string, venueId: string, id: string) {
 return withSessionAudit("company/venues.removeVenueStaff", async () => {
  try {
   const db = await access(slug, venueId);
   await db.$transaction(async tx => {
    await tx.venueStaff.deleteMany({ where: { id, venueId } });
    const pending = await tx.event.findMany({ where: { venueId, status: { in: ["PENDING_TRAINER_CONFIRMATION", "PENDING_VENUE_CONFIRMATION"] } }, select: { id: true } });
    for (const event of pending) await synchronizeTrainerConfirmation(tx, event.id);
   }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
   await deliverPendingVenueConfirmations();
   revalidatePath("/account/eventmanagement");
   revalidatePath("/company/[companyKey]", "layout");
   revalidatePath("/events", "layout");
   return { success: true };
  } catch (error) { return { message: failure(error) }; }
 });
}
