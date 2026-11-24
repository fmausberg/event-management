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

    where: { OR: [

      { status: "PENDING_TRAINER_CONFIRMATION", trainers: { some: ownTrainer } },

      { status: { in: ["PUBLISHED", "CANCELLED", "COMPLETED"] }, OR: [

      { staff: { some: ownStaff } },

      { venue: { staff: { some: ownStaff } } },

      { trainers: { some: ownTrainer } },

    ] },

    ] },

    orderBy: [{ beginsAt: { sort: "asc", nulls: "last" } }, { id: "asc" }],

    select: {

      id: true, name: true, beginsAt: true, endsAt: true, status: true,

      company: { select: { name: true, slug: true } },

      bookings: { where: { status: "CONFIRMED" }, select: { _count: { select: { tickets: { where: { status: "VALID" } } } } } },

      venue: { select: { name: true, staff: { where: ownStaff, select: { id: true }, take: 1 } } },

      staff: { where: ownStaff, select: { id: true }, take: 1 },

      trainers: { where: ownTrainer, select: { id: true, responseStatus: true } },

    },

  });

  return rows.map(({ staff, venue, trainers, bookings, ...event }) => ({

    ...event,

    trainerAssignments: trainers,

    venueName: venue?.name ?? null,

    confirmedBookingCount: bookings.length,

    validTicketCount: bookings.reduce((total, booking) => total + booking._count.tickets, 0),

    roles: [

      ...(staff.length ? ["Veranstaltungsteam"] : []),

      ...(venue?.staff.length ? ["Ortsteam"] : []),

      ...(trainers.length ? ["Trainer"] : []),

    ],

  }));

}

