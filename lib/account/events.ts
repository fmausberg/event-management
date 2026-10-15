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
  const ownBooking = { userId: user.id };
  // Match unlinked trainer profiles using the same account-email convention as staff.
  // Never take a profile already linked to a different account.
  const trainerIdentity = await trainerIdentityForUser(user);
  const ownStaff = { userId: user.id };
  const rows = await db.event.findMany({
    where: { status: { in: ["PUBLISHED", "CANCELLED", "COMPLETED"] }, OR: [
      { bookings: { some: ownBooking } },
      { trainers: { some: { trainer: trainerIdentity } } },
      { staff: { some: ownStaff } },
      { venue: { staff: { some: ownStaff } } },
    ] },
    orderBy: [{ beginsAt: "desc" }, { id: "asc" }],
    select: {
      id: true, name: true, beginsAt: true, endsAt: true, status: true,
      company: { select: { name: true, slug: true } },
      venue: { select: { name: true, staff: { where: ownStaff, select: { id: true }, take: 1 } } },
      bookings: { where: ownBooking, select: { status: true }, distinct: ["status"] },
      trainers: { where: { trainer: trainerIdentity }, select: { id: true }, take: 1 },
      staff: { where: ownStaff, select: { id: true }, take: 1 },
    },
  });
  return rows.map(({ bookings, trainers, staff, venue, ...event }) => ({
    ...event,
    venueName: venue?.name ?? null,
    bookingStatuses: bookings.map((booking) => booking.status),
    roles: [
      ...(bookings.length ? ["Teilnehmer"] : []),
      ...(trainers.length ? ["Trainer"] : []),
      ...(staff.length ? ["Event-Staff"] : []),
      ...(venue?.staff.length ? ["Venue-Staff"] : []),
    ],
  }));
}
