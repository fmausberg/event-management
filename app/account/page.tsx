import { redirect } from "next/navigation";
import Link from "next/link";
import { getPrisma } from "@/lib/db/prisma";
import { auth } from "@/auth";
import { logout } from "@/app/(auth)/actions";

export const metadata = { title: "Eventverwaltung" };

export default async function AccountPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const db = getPrisma();
  const [venueStaff, eventStaff] = await Promise.all([
    db.venueStaff.findMany({
      where: { userId: session.user.id }, orderBy: [{ venue: { name: "asc" } }, { id: "asc" }],
      select: { id: true, venue: { select: { name: true, company: { select: { name: true } } } }, assignedBy: { select: { email: true } } },
    }),
    db.eventStaff.findMany({
      where: { userId: session.user.id }, orderBy: [{ event: { beginsAt: "asc" } }, { id: "asc" }],
      select: { id: true, event: { select: { id: true, name: true, beginsAt: true, company: { select: { name: true, slug: true } } } }, assignedBy: { select: { email: true } } },
    }),
  ]);
  const bookings = await getPrisma().booking.findMany({
    where: { userId: session.user.id },
    orderBy: [{ bookedAt: "desc" }, { id: "asc" }],
    select: {
      id: true,
      number: true,
      quantity: true,
      status: true,
      event: { select: { name: true, beginsAt: true } },
    },
  });
  const date = new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Berlin",
  });
  return (
    <main className="flex flex-1 flex-col bg-zinc-50 px-6 py-12 sm:px-16 dark:bg-black">
      <h1 className="text-2xl font-semibold">Dein Konto</h1>
      <p className="mt-4">Angemeldet als {session.user.name || session.user.email}</p>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{session.user.email}</p>
      <div className="mt-6">
        <Link href="/account/scan" className="mb-4 inline-block rounded-lg bg-primary-600 px-4 py-2 text-white">Tickets scannen</Link>
        <form action={logout}><button className="rounded-lg bg-zinc-900 px-4 py-2 text-white dark:bg-zinc-100 dark:text-zinc-900">Abmelden</button></form>
      </div>
      <section className="mt-10">
        <h2 className="text-xl font-semibold">Meine Buchungen</h2>
        {bookings.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">Du hast noch keine Buchungen.</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <caption className="sr-only">Deine Buchungen</caption>
              <thead className="bg-zinc-100 dark:bg-zinc-900">
                <tr>
                  <th scope="col" className="px-4 py-3">Buchungsnr.</th>
                  <th scope="col" className="px-4 py-3">Veranstaltung</th>
                  <th scope="col" className="px-4 py-3">Beginn (Europe/Berlin)</th>
                  <th scope="col" className="px-4 py-3">Plätze</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((booking) => (
                  <tr key={booking.id} className="border-t border-zinc-200 dark:border-zinc-800">
                    <td className="px-4 py-3">#{booking.number}</td>
                    <th scope="row" className="px-4 py-3 font-medium">{booking.event.name}</th>
                    <td className="whitespace-nowrap px-4 py-3">{booking.event.beginsAt ? date.format(booking.event.beginsAt) : "Noch offen"}</td>
                    <td className="px-4 py-3">{booking.quantity}</td>
                    <td className="px-4 py-3">{({ CONFIRMED: "Bestätigt", CANCELLED: "Storniert", PENDING_PAYMENT: "Zahlung ausstehend", EXPIRED: "Abgelaufen" })[booking.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {venueStaff.length > 0 && <section className="mt-10">
        <h2 className="text-xl font-semibold">Meine VenueStaff-Einteilungen</h2>
        <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <caption className="sr-only">Deine VenueStaff-Einteilungen</caption>
            <thead className="bg-zinc-100 dark:bg-zinc-900"><tr>{["Venuename", "Assigner-E-Mail", "Company"].map((label) => <th scope="col" key={label} className="px-4 py-3">{label}</th>)}</tr></thead>
            <tbody>{venueStaff.map((row) => <tr key={row.id} className="border-t border-zinc-200 dark:border-zinc-800">
              <th scope="row" className="px-4 py-3 font-medium">{row.venue.name}</th>
              <td className="px-4 py-3">{row.assignedBy.email}</td>
              <td className="px-4 py-3">{row.venue.company.name}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>}
      {eventStaff.length > 0 && <section className="mt-10">
        <h2 className="text-xl font-semibold">Meine EventStaff-Einteilungen</h2>
        <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <caption className="sr-only">Deine EventStaff-Einteilungen</caption>
            <thead className="bg-zinc-100 dark:bg-zinc-900"><tr>{["Eventname", "Eventbeginn (Europe/Berlin)", "Assigner-E-Mail", "Company"].map((label) => <th scope="col" key={label} className="px-4 py-3">{label}</th>)}</tr></thead>
            <tbody>{eventStaff.map((row) => <tr key={row.id} className="border-t border-zinc-200 dark:border-zinc-800">
              <th scope="row" className="px-4 py-3 font-medium"><Link href={`/events/${encodeURIComponent(row.event.company.slug)}/${encodeURIComponent(row.event.id)}`} className="text-primary-700 underline dark:text-primary-300">{row.event.name}</Link></th>
              <td className="whitespace-nowrap px-4 py-3">{row.event.beginsAt ? date.format(row.event.beginsAt) : "Noch offen"}</td>
              <td className="px-4 py-3">{row.assignedBy.email}</td>
              <td className="px-4 py-3">{row.event.company.name}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>}
    </main>
  );
}
