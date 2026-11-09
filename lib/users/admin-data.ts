import "server-only";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getPrisma } from "@/lib/db/prisma";

export async function getUsersForAdmin() {
  await requireAdmin();
  const users = await getPrisma().user.findMany({
    orderBy: { number: "asc" },
    select: {
      id: true, number: true, name: true, email: true, emailVerified: true, role: true,
      memberships: {
        where: { status: "ACTIVE" },
        orderBy: { company: { name: "asc" } },
        select: { company: { select: { name: true } } },
      },
      bookings: {
        select: {
          _count: { select: { tickets: true } },
          tickets: { where: { checkedInAt: { not: null } }, select: { id: true } },
        },
      },
    },
  });
  return users.map(({ memberships, bookings, ...user }) => ({
    ...user,
    companies: memberships.map(({ company }) => company.name),
    purchasedTickets: bookings.reduce((total, booking) => total + booking._count.tickets, 0),
    redeemedTickets: bookings.reduce((total, booking) => total + booking.tickets.length, 0),
  }));
}
