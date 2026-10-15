"use server";
import { Prisma } from "@prisma/client";
import { notifyAssignment } from "@/lib/mail/assignment";
import { auth } from "@/auth";
import { requireCompanyAccess, MemberAccessError } from "@/lib/companies/members";
import { getPrisma } from "@/lib/db/prisma";
import { emailSchema } from "@/lib/auth/validation";

async function access(slug: string, eventId: string) {
 const { company } = await requireCompanyAccess(slug);
 const db = getPrisma();
 if (!await db.event.findFirst({ where: { id: eventId, companyId: company.id }, select: { id: true } })) throw new Error("EVENT_NOT_FOUND");
 return db;
}
function failure(error: unknown) {
 if (error instanceof MemberAccessError) return error.message;
 if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "Diese E-Mail-Adresse ist bereits zugeordnet.";
 return "EventStaff konnte nicht geladen oder gespeichert werden. Bitte versuche es erneut.";
}
export async function listEventStaff(slug: string, eventId: string) {
 try {
  const db = await access(slug, eventId);
  const rows = await db.eventStaff.findMany({ where: { eventId }, select: { id: true, email: true, user: { select: { email: true, emailVerified: true } } } });
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
export async function addEventStaff(slug: string, eventId: string, email: string) {
 try {
  const db = await access(slug, eventId);
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return { message: parsed.error.issues[0].message };
  const actor = (await auth())?.user?.id;
  if (!actor) throw new MemberAccessError("UNAUTHENTICATED");
  const users = await db.user.findMany({ where: { email: { equals: parsed.data, mode: "insensitive" } }, select: { id: true, emailVerified: true } });
  if (users.length > 1) return { message: "Die E-Mail-Adresse ist keinem eindeutigen Account zugeordnet." };
  const assignment = await db.eventStaff.create({ data: { eventId, email: parsed.data, userId: users[0]?.emailVerified ? users[0].id : null, assignedById: actor } });
  const notification = await notifyAssignment("event", slug, assignment.id);
  return { success: true, message: notification.message };
 } catch (error) { return { message: failure(error) }; }
}
export async function removeEventStaff(slug: string, eventId: string, id: string) {
 try {
  const db = await access(slug, eventId);
  await db.eventStaff.deleteMany({ where: { id, eventId } });
  return { success: true };
 } catch (error) { return { message: failure(error) }; }
}
