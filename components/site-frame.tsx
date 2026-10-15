import Link from "next/link";
import { NavigationIcon } from "./navigation-icon";

export function SiteFrame({ children }: { children: React.ReactNode }) {
    return <div className="flex min-h-dvh flex-1 flex-col bg-white text-zinc-900 dark:bg-black dark:text-zinc-100">
        <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            <div className="mx-auto flex min-h-20 max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8">
                <Link href="/" className="flex items-center gap-3 rounded-md font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-primary-600"><span className="rounded-xl bg-[var(--brand-icon-background,#007c80)] p-2.5 text-white"><NavigationIcon name="calendar" /></span><span>Event-Management</span></Link>
                <Link href="/account" className="rounded-lg bg-accent-500 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-accent-400 focus-visible:outline-2 focus-visible:outline-primary-600 dark:text-zinc-950 dark:hover:bg-accent-400">Zur Plattform <span aria-hidden="true">↗</span></Link>
            </div>
        </header>
        {children}
        <footer className="border-t border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
            <div className="mx-auto flex max-w-6xl flex-wrap items-start justify-between gap-6 px-5 py-8 text-sm sm:px-8"><address className="not-italic leading-relaxed text-zinc-600 dark:text-zinc-400">Felix Mausberg<br />Breite Straße 33a<br />41460 Neuss</address><Link href="/impressum" className="rounded text-zinc-600 underline underline-offset-4 hover:text-primary-700 focus-visible:outline-primary-600 dark:text-zinc-400">Impressum</Link></div>
        </footer>
    </div>;
}
