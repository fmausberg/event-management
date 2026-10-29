import "server-only";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getPrisma } from "@/lib/db/prisma";
import { trainerIdentityForUser } from "@/lib/trainers/identity";

export async function getMyEvents() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const db = getPrisma();
  const user = await db.user.findUnique({ where: { id: session.user.id }, select: { id: true, email: true } });
  if (!user) redirect("/login");
  const ownStaff = { userId: user.id };
  const ownTrainer = { trainer: await trainerIdentityForUser(user) };
  const rows = await db.event.findMany({
    where: { status: { in: ["PUBLISHED", "CANCELLED", "COMPLETED"] }, OR: [
      { staff: { some: ownStaff } },
      { venue: { staff: { some: ownStaff } } },
      { trainers: { some: ownTrainer } },
    ] },
    orderBy: [{ beginsAt: "desc" }, { id: "asc" }],
    select: {
      id: true, name: true, beginsAt: true, endsAt: true, status: true,
      company: { select: { name: true, slug: true } },
      venue: { select: { name: true, staff: { where: ownStaff, select: { id: true }, take: 1 } } },
      staff: { where: ownStaff, select: { id: true }, take: 1 },
      trainers: { where: ownTrainer, select: { id: true }, take: 1 },
    },
  });
  return rows.map(({ staff, venue, trainers, ...event }) => ({
    ...event,
    venueName: venue?.name ?? null,
    roles: [
      ...(staff.length ? ["Event-Staff"] : []),
      ...(venue?.staff.length ? ["Venue-Staff"] : []),
      ...(trainers.length ? ["Trainer"] : []),
    ],
  }));
}
