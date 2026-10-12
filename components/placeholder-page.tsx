import Link from "next/link";

export function PlaceholderPage({ title, children }: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex flex-1 flex-col bg-zinc-50 px-6 py-12 text-zinc-950 sm:px-16 dark:bg-black dark:text-zinc-50">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-4 text-zinc-600 dark:text-zinc-400">{children}</p>
      <Link href="/" className="mt-8 w-fit text-sm underline">Zur Startseite</Link>
    </main>
  );
}
