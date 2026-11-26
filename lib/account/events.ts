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
      { status: "PENDING_VENUE_CONFIRMATION", OR: [{ trainers: { some: ownTrainer } }, { venue: { staff: { some: ownStaff } }, trainers: { none: { responseStatus: { not: "ACCEPTED" } } } }] },

      { status: { in: ["PUBLISHED", "CANCELLED", "COMPLETED"] }, OR: [

      { staff: { some: ownStaff } },

      { venue: { staff: { some: ownStaff } }, trainers: { none: { responseStatus: { not: "ACCEPTED" } } } },

      { trainers: { some: ownTrainer } },

    ] },

    ] },

    orderBy: [{ beginsAt: { sort: "asc", nulls: "last" } }, { id: "asc" }],

    select: {

      id: true, name: true, beginsAt: true, endsAt: true, status: true, updatedAt: true, venueId: true, venueApproval: { select: { id: true, venueId: true, status: true, updatedAt: true } },

      company: { select: { name: true, slug: true } },

      bookings: { where: { status: "CONFIRMED" }, select: { _count: { select: { tickets: { where: { status: "VALID" } } } } } },

      venue: { select: { id: true, name: true, staff: { where: ownStaff, select: { id: true }, take: 1 } } },

      staff: { where: ownStaff, select: { id: true }, take: 1 },

      trainers: { select: { id: true, responseStatus: true, trainer: { select: { userId: true, firstName: true, lastName: true } } } },

    },

  });

  return rows.map(({ staff, venue, trainers, bookings, ...event }) => ({

    ...event,

    trainerAssignments: trainers.filter(assignment => assignment.trainer.userId === user.id).map(({ id, responseStatus }) => ({ id, responseStatus })),
    trainerDisplayName: trainers.map(assignment => `${assignment.trainer.firstName} ${assignment.trainer.lastName}`.trim()).filter(Boolean).join(", "),

    venueName: venue?.name ?? null,
    venueResponse: venue?.staff.length ? event.venueApproval?.venueId === event.venueId ? event.venueApproval
      : !event.venueApproval && ["PUBLISHED", "CANCELLED", "COMPLETED"].includes(event.status) ? { id: `legacy:${event.id}`, venueId: event.venueId, status: "ACCEPTED" as const, updatedAt: event.updatedAt } : null : null,

    confirmedBookingCount: bookings.length,

    validTicketCount: bookings.reduce((total, booking) => total + booking._count.tickets, 0),

    roles: [

      ...(staff.length ? ["Veranstaltungsteam"] : []),

      ...(venue?.staff.length ? ["Ortsteam"] : []),

      ...(trainers.some(assignment => assignment.trainer.userId === user.id) ? ["Trainer"] : []),

    ],

  }));

}

