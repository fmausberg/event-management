import { notFound, redirect } from "next/navigation";
import { AdminAccessError } from "@/lib/auth/require-admin";
import { getUsersForAdmin } from "@/lib/users/admin-data";

export const metadata = { title: "User-Übersicht" };

export default async function AdminUsersPage() {
  let users;
  try {
    users = await getUsersForAdmin();
  } catch (error) {
    if (error instanceof AdminAccessError) {
      if (error.reason === "UNAUTHENTICATED") redirect("/login");
      notFound();
    }
    return <main className="flex-1 p-6 sm:p-10"><h1 className="text-2xl font-semibold">User</h1><p role="alert" className="mt-4">Die User konnten gerade nicht geladen werden.</p><a href="/admin/users" className="mt-4 inline-block underline">Erneut versuchen</a></main>;
  }
  return <main className="flex min-w-0 flex-1 flex-col gap-6 bg-zinc-50 p-6 sm:p-10 dark:bg-black">
    <div><h1 className="text-2xl font-semibold">User</h1><p className="mt-1 text-sm text-zinc-500">{users.length} User auf der Plattform</p></div>
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Alle Plattform-User mit Ticketzahlen und aktiven Unternehmenszuordnungen</caption>
        <thead className="border-b border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900"><tr>{["Nummer", "Name", "E-Mail", "Tickets: eingelöst / gekauft", "Unternehmen"].map((heading) => <th key={heading} scope="col" className="whitespace-nowrap px-4 py-3 font-medium">{heading}</th>)}</tr></thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {users.map((user) => <tr key={user.id}>
            <td className="px-4 py-3 tabular-nums">{user.number}</td>
            <td className="px-4 py-3 font-medium">{user.name || "–"}</td>
            <td className="px-4 py-3">{user.email}</td>
            <td className="whitespace-nowrap px-4 py-3 tabular-nums">{user.redeemedTickets} / {user.purchasedTickets}</td>
            <td className="px-4 py-3">{user.companies.join(", ") || "–"}</td>
          </tr>)}
          {users.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-zinc-500">Es gibt noch keine User auf der Plattform.</td></tr>}
        </tbody>
      </table>
    </div>
    <p className="text-sm text-zinc-500">Tickets: mit Check-in / insgesamt ausgestellte Tickets, einschließlich später stornierter Tickets. Unternehmen: aktive Mitgliedschaften.</p>
  </main>;
}
