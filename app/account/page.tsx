import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { logout } from "@/app/(auth)/actions";

export const metadata = { title: "Dein Konto | Eventverwaltung" };

export default async function AccountPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return (
    <main className="flex flex-1 flex-col bg-zinc-50 px-6 py-12 sm:px-16 dark:bg-black">
      <h1 className="text-2xl font-semibold">Dein Konto</h1>
      <p className="mt-4">Angemeldet als {session.user.name || session.user.email}</p>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{session.user.email}</p>
      <div className="mt-6 flex items-center gap-6">
        <Link href="/events" className="underline">Zur Eventübersicht</Link>
        <form action={logout}><button className="rounded-lg bg-zinc-900 px-4 py-2 text-white dark:bg-zinc-100 dark:text-zinc-900">Abmelden</button></form>
      </div>
    </main>
  );
}
