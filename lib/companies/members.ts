import "server-only";
import { auth } from "@/auth";
import { getPrisma } from "@/lib/db/prisma";
import { companyIdSchema } from "./validation";

export class MemberAccessError extends Error {
  constructor(public readonly reason: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND") {
    super(reason === "UNAUTHENTICATED" ? "Bitte melde dich erneut an." : reason === "NOT_FOUND" ? "Diese Company existiert nicht mehr." : "Du darfst diese Company nicht verwalten.");
  }
}

export async function requireCompanyAdmin(companySlug: string) {
  return (await requireCompanyAccess(companySlug, true)).company;
}

export async function requireCompanyAccess(companySlug: string, adminOnly = false) {
  const session = await auth();
  if (!session?.user?.id) throw new MemberAccessError("UNAUTHENTICATED");
  if (!companyIdSchema.safeParse(companySlug).success) throw new MemberAccessError("NOT_FOUND");
  const db = getPrisma();
  const user = await db.user.findUnique({ where: { id: session.user.id }, select: { role: true } });
  if (!user) throw new MemberAccessError("FORBIDDEN");
  const company = await db.company.findUnique({ where: { slug: companySlug }, select: { id: true, name: true, slug: true } });
  if (!company) throw new MemberAccessError("NOT_FOUND");
  let canManage = user.role === "ADMIN";
  if (user.role !== "ADMIN") {
    const membership = await db.companyMembership.findUnique({
      where: { companyId_userId: { companyId: company.id, userId: session.user.id } },
      select: { role: true, status: true },
    });
    if (!membership || membership.status !== "ACTIVE" || (adminOnly && membership.role !== "COMPANY_ADMIN")) throw new MemberAccessError("FORBIDDEN");
    canManage = true;
  }
  return { company, canManage };
}

export async function getCompanyMembers(companySlug: string) {
  const company = await requireCompanyAdmin(companySlug);
  const db = getPrisma();
  const memberships = await db.companyMembership.findMany({
    where: { companyId: company.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, email: true, role: true, user: { select: { email: true, emailVerified: true } } },
  });
  const emails = memberships.filter((member) => !member.user && member.email).map((member) => member.email!);
  const accounts = emails.length ? await db.user.findMany({
    where: { email: { in: emails, mode: "insensitive" } }, select: { email: true, emailVerified: true },
  }) : [];
  return { company, members: memberships.map((member) => {
    const matches = accounts.filter((account) => account.email.toLowerCase() === member.email);
    const account = member.user ?? (matches.length === 1 ? matches[0] : null);
    return { id: member.id, role: member.role, email: member.user?.email ?? member.email ?? "—", status: account ? account.emailVerified ? "verified" : "not verified" : "no account" };
  }) };
}
