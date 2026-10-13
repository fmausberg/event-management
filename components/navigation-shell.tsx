"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { logout } from "@/app/(auth)/actions";
import { isNavigationItemActive, type NavigationData } from "@/lib/navigation/model";
import { NavigationIcon } from "./navigation-icon";

function NavigationLinks({ data, pathname, onNavigate }: {
  data: NavigationData; pathname: string; onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Hauptnavigation" className="flex-1 space-y-7 overflow-y-auto px-3 py-5">
      {data.groups.map((group) => (
        <section key={group.id} aria-label={group.label}>
          <h2 className="mb-2 break-words px-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">{group.label}</h2>
          <ul className="space-y-1">
            {group.items.map((item) => {
              const active = isNavigationItemActive(pathname, item.href);
              return <li key={item.href}>
                <Link href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 ${active
                    ? "bg-violet-100 font-medium text-violet-800 dark:bg-violet-950 dark:text-violet-200"
                    : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}>
                  <NavigationIcon name={item.icon} />{item.label}
                </Link>
              </li>;
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}

function UserFooter({ data, onNavigate }: { data: NavigationData; onNavigate?: () => void }) {
  const name = data.user.name || data.user.email;
  return <div className="flex items-center gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800">
    <Link href="/account" onClick={onNavigate} aria-label={`Mein Konto: ${name}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1.5 hover:bg-violet-50 focus-visible:outline-violet-600 dark:hover:bg-zinc-800">
      <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-violet-600 text-sm font-medium text-white">{Array.from(name.trim())[0]?.toUpperCase() || "U"}</span>
      <span className="min-w-0"><span className="block truncate text-sm font-medium">{name}</span><span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{data.user.email}</span></span>
    </Link>
    <form action={logout}><button type="submit" aria-label="Abmelden" title="Abmelden" className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-violet-600 dark:hover:bg-zinc-800 dark:hover:text-white"><NavigationIcon name="logout" /></button></form>
  </div>;
}

export function NavigationShell({ data, children }: { data: NavigationData; children?: React.ReactNode }) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(true);
  const mobileMenu = useRef<HTMLDetailsElement>(null);
  const closeMobileMenu = () => { if (mobileMenu.current) mobileMenu.current.open = false; };
  const current = data.groups.flatMap((group) => group.items.map((item) => ({ ...item, group: group.label })))
    .find((item) => isNavigationItemActive(pathname, item.href));
  const title = pathname === "/account" ? "Mein Konto" : current?.label || "Eventverwaltung";
  const context = current && current.group !== "Allgemein" ? current.group : null;

  if (pathname === "/events" || pathname.startsWith("/events/")) return <>{children}</>;

  return (
    <div className="flex min-h-dvh flex-1 font-sans">
      <a href="#page-content" className="sr-only z-50 rounded bg-violet-600 p-3 text-white focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Zum Inhalt springen</a>
      <aside id="desktop-navigation" aria-label="Seitenleiste" className={`sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-zinc-200 bg-[#faf9ff] ${expanded ? "md:flex" : "md:hidden"} dark:border-zinc-800 dark:bg-zinc-950`}>
        <Link href="/events" className="flex h-14 shrink-0 items-center gap-3 border-b border-zinc-200 px-5 font-semibold dark:border-zinc-800">
          <span className="rounded-lg bg-violet-600 p-2 text-white"><NavigationIcon name="calendar" /></span>Eventverwaltung
        </Link>
        <NavigationLinks data={data} pathname={pathname} />
        <UserFooter data={data} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <div className="hidden h-14 items-center gap-4 px-5 md:flex">
            <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-controls="desktop-navigation" aria-label={expanded ? "Navigation einklappen" : "Navigation ausklappen"} className="rounded-md p-2 hover:bg-zinc-100 focus-visible:outline-violet-600 dark:hover:bg-zinc-800"><NavigationIcon name="panel" /></button>
            <div className="flex min-w-0 items-center gap-3 text-sm">{context && <><span className="truncate text-zinc-500">{context}</span><span aria-hidden="true" className="text-zinc-300">/</span></>}<span className="shrink-0 font-medium">{title}</span></div>
          </div>
          <details ref={mobileMenu} className="group md:hidden" onKeyDown={(event) => { if (event.key === "Escape") { closeMobileMenu(); mobileMenu.current?.querySelector("summary")?.focus(); } }}>
            <summary className="flex h-14 cursor-pointer list-none items-center gap-3 px-5 text-sm font-medium [&::-webkit-details-marker]:hidden"><NavigationIcon name="panel" /><span>Menü</span><span className="ml-auto truncate text-zinc-500">{title}</span></summary>
            <div className="flex max-h-[calc(100dvh-3.5rem)] flex-col overflow-y-auto border-t border-zinc-200 bg-[#faf9ff] dark:border-zinc-800 dark:bg-zinc-950">
              <NavigationLinks data={data} pathname={pathname} onNavigate={closeMobileMenu} />
              <UserFooter data={data} onNavigate={closeMobileMenu} />
            </div>
          </details>
        </header>
        <div id="page-content" tabIndex={-1} className="flex min-w-0 flex-1 flex-col outline-none">{children}</div>
      </div>
    </div>
  );
}
