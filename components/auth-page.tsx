import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { oauthLogin } from "@/app/(auth)/actions";
import { getOAuthProviders } from "@/lib/auth/providers";
import { AuthForm } from "./auth-form";

export async function AuthPage({ mode, error, registered }: {
  mode: "login" | "register"; error?: string; registered?: boolean;
}) {
  const session = await auth();
  if (session?.user) redirect("/account");
  const registering = mode === "register";
  const providers = getOAuthProviders();
  const errorMessage = error === "OAuthAccountNotLinked"
    ? "Diese E-Mail-Adresse gehört bereits zu einem Konto. Bitte nutze dessen bisherige Anmeldemethode."
    : error === "AccessDenied"
      ? "Die Anmeldung wurde abgelehnt. Bitte verwende einen Anbieter mit gültiger E-Mail-Adresse."
      : error === "CredentialsSignin"
        ? "E-Mail-Adresse oder Passwort ist falsch."
        : "Die Anmeldung konnte nicht abgeschlossen werden. Bitte versuche es erneut oder nutze eine andere Anmeldemethode.";
  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 px-6 py-12 dark:bg-black">
      <section className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 sm:p-8 dark:border-zinc-800 dark:bg-zinc-950">
        <Link href="/" className="text-sm text-zinc-600 hover:underline dark:text-zinc-400">← Startseite</Link>
        <h1 className="mt-6 text-2xl font-semibold">{registering ? "Konto erstellen" : "Willkommen zurück"}</h1>
        <p className="mb-6 mt-2 text-sm text-zinc-600 dark:text-zinc-400">{registering ? "Registriere dich für die Eventverwaltung." : "Melde dich bei der Eventverwaltung an."}</p>
        {error && <p role="alert" className="mb-5 text-sm text-red-700 dark:text-red-400">{errorMessage}</p>}
        {registered && <p role="status" className="mb-5 text-sm text-green-700 dark:text-green-400">Dein Konto wurde erstellt. Du kannst dich jetzt anmelden.</p>}
        <AuthForm mode={mode} />
        {providers.length > 0 && <div className="mt-6 space-y-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <p className="text-center text-sm text-zinc-500">Oder mit einem Anbieter fortfahren</p>
          {providers.map((provider) => <form key={provider.id} action={oauthLogin}>
            <input type="hidden" name="provider" value={provider.id} />
            <button className="w-full rounded-lg border border-zinc-300 px-4 py-2.5 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900">Mit {provider.name} fortfahren</button>
          </form>)}
        </div>}
        <p className="mt-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
          {registering ? "Du hast bereits ein Konto? " : "Noch kein Konto? "}
          <Link href={registering ? "/login" : "/register"} className="font-medium text-zinc-950 underline dark:text-zinc-50">{registering ? "Anmelden" : "Registrieren"}</Link>
        </p>
      </section>
    </main>
  );
}
