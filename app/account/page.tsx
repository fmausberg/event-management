import { redirect } from "next/navigation";
import { getPrisma } from "@/lib/db/prisma";
import { auth } from "@/auth";
import { logout } from "@/app/(auth)/actions";

export const metadata = { title: "Dein Konto | Eventverwaltung" };

export default async function AccountPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
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
                    <td className="whitespace-nowrap px-4 py-3">{date.format(booking.event.beginsAt)}</td>
                    <td className="px-4 py-3">{booking.quantity}</td>
                    <td className="px-4 py-3">{booking.status === "CONFIRMED" ? "Bestätigt" : "Storniert"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
