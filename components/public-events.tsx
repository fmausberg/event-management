"use client";
import Link from "next/link";
import { useRef, useState } from "react";
export type PublicEvent = { imageUrl?: string | null; remainingSeats: number; id: string; name: string; shortdescription: string | null; beginsAt: string; ticketPrice: string; currency: string; company: { name: string; slug: string }; venue: { name: string; city: string | null } | null; eventSeries: { imageUrl: string | null } | null };
export function PublicHeader({ signedIn = false }: { signedIn?: boolean }) {
  const menu = useRef<HTMLDetailsElement>(null);
  return <header className="mx-auto flex h-16 w-full max-w-6xl items-center justify-end px-5 sm:px-8">
    <details ref={menu} className="relative z-30" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.open = false; }} onKeyDown={(e) => { if (e.key === "Escape") { e.currentTarget.open = false; e.currentTarget.querySelector("summary")?.focus(); } }}>
      <summary aria-label="Menü öffnen" title="Menü" className="cursor-pointer list-none rounded-full p-2 text-zinc-500 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-primary-600 [&::-webkit-details-marker]:hidden"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m9 3-.6 2.2-2 .9-2-.6-2 3.4 1.6 1.7v2.8l-1.6 1.7 2 3.4 2-.6 2 .9L9 21h4l.6-2.2 2-.9 2 .6 2-3.4-1.6-1.7v-2.8l1.6-1.7-2-3.4-2 .6-2-.9L13 3Z" /><circle cx="11" cy="12" r="3" /></svg></summary>
      <nav aria-label="Öffentliches Menü" className="absolute right-0 mt-2 w-44 rounded-xl border border-zinc-200 bg-white p-1.5 text-sm shadow-lg">{(signedIn ? [["Mein Profil", "/account"], ["Zur Plattform", "/account"], ["Information", "/"]] : [["Einloggen", "/login"], ["Registrieren", "/register"], ["Information", "/"]]).map(([label, href]) => <Link key={label} href={href} onClick={() => { if (menu.current) menu.current.open = false; }} className="block rounded-lg px-4 py-2.5 hover:bg-primary-50 focus-visible:outline-primary-600">{label}</Link>)}</nav>
    </details>
  </header>;
}
function EventImage({ event }: { event: PublicEvent }) {
  const [failed, setFailed] = useState(false);
  const url = event.imageUrl;
  const valid = url && /^https?:\/\//i.test(url);
  return <div className="relative aspect-[16/9] overflow-hidden bg-primary-50">
    {valid && !failed ? /* External series images are rendered without a server-side image proxy. */
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" /> : <div className="flex h-full items-center justify-center bg-gradient-to-br from-primary-100 via-primary-50 to-amber-50"><svg aria-hidden="true" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="text-primary-600/50"><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 11h18m-14 4h3m4 0h3m-10 3h3" /></svg></div>}
  </div>;
}
export function PublicEvents({ events, companyName, embedded = false }: { events: PublicEvent[]; companyName?: string; embedded?: boolean }) {
  const [query, setQuery] = useState(""); const [search, setSearch] = useState(""); const [sort, setSort] = useState("date");
  const [city, setCity] = useState("");
  const cities = [...new Map(events.flatMap((event) => {
    const name = event.venue?.city?.trim();
    return name ? [[name.toLocaleLowerCase("de-DE"), name] as const] : [];
  })).entries()].sort((a, b) => a[1].localeCompare(b[1], "de"));
  const visible = events.filter((e) => (!city || e.venue?.city?.trim().toLocaleLowerCase("de-DE") === city) && [e.name, e.shortdescription, e.company.name, e.venue?.name, e.venue?.city].join(" ").toLocaleLowerCase("de-DE").includes(search.toLocaleLowerCase("de-DE"))).sort((a, b) => sort === "name" ? a.name.localeCompare(b.name, "de") : sort === "latest" ? b.beginsAt.localeCompare(a.beginsAt) : a.beginsAt.localeCompare(b.beginsAt));
  return <main className="mx-auto w-full max-w-6xl px-5 pb-16 pt-4 sm:px-8">
    {!embedded && <><h1 className="text-3xl font-semibold tracking-tight">{companyName ? `Events – ${companyName}` : "Events"}</h1><p className="mt-2 text-sm text-zinc-500">Entdecke dein nächstes Erlebnis.</p></>}
    <form onSubmit={(e) => { e.preventDefault(); setSearch(query.trim()); }} className="my-7 flex flex-wrap items-end gap-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="min-w-48 flex-1">
        <label htmlFor="public-search" className="text-sm font-medium">Name oder Ort</label>
        <input id="public-search" type="search" value={query} onChange={(e) => { setQuery(e.target.value); if (!e.target.value) setSearch(""); }} placeholder="Events suchen …" className="mt-2 w-full rounded-md border border-zinc-300 px-3 py-2.5 text-sm focus:outline-2 focus:outline-primary-600" />
      </div>
      <div className="w-full sm:w-44">
        <label htmlFor="public-city" className="text-sm font-medium">Stadt</label>
        <select id="public-city" value={city} onChange={(e) => setCity(e.target.value)} className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2.5 text-sm focus:outline-primary-600">
          <option value="">Alle Städte</option>
          {cities.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      <button className="rounded-md bg-primary-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600">Suchen</button>
      <div className="w-full sm:ml-auto sm:w-52">
        <label htmlFor="public-sort" className="text-sm font-medium">Sortierung</label>
        <select id="public-sort" value={sort} onChange={(e) => setSort(e.target.value)} className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2.5 text-sm focus:outline-primary-600">
          <option value="date">Datum aufsteigend</option>
          <option value="latest">Datum absteigend</option>
          <option value="name">Name A–Z</option>
        </select>
      </div>
    </form>
    <p role="status" className="mb-4 text-sm text-zinc-500">{visible.length} {visible.length === 1 ? "Event" : "Events"}</p>
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {visible.map((event) => <article key={event.id} className="group flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm transition-shadow hover:shadow-md">
        <EventImage key={event.imageUrl ?? event.id} event={event} />
        <div className="flex flex-1 flex-col p-5"><p className="text-xs font-medium text-primary-700">{new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" }).format(new Date(event.beginsAt))} Uhr</p><h2 className="mt-2 text-lg font-semibold leading-snug"><Link target={embedded ? "_blank" : undefined} rel={embedded ? "noopener noreferrer" : undefined} href={`/events/${encodeURIComponent(event.company.slug)}/${encodeURIComponent(event.id)}`} className="hover:text-primary-700 focus-visible:outline-primary-600">{event.name}</Link></h2><p className="mt-2 text-sm text-zinc-600">{event.venue ? [event.venue.name, event.venue.city].filter(Boolean).join(" · ") : event.company.name}</p>{event.shortdescription && <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-zinc-500">{event.shortdescription}</p>}
          <div className="mt-auto flex items-end justify-between gap-3 pt-6"><span className="text-xs text-zinc-400">{event.company.name}</span>{event.remainingSeats <= 0 ? <button type="button" disabled className="shrink-0 cursor-not-allowed rounded-md bg-zinc-200 px-4 py-2.5 text-sm font-semibold text-zinc-500">ausgebucht</button> : <Link target={embedded ? "_blank" : undefined} rel={embedded ? "noopener noreferrer" : undefined} href={`/events/${encodeURIComponent(event.company.slug)}/${encodeURIComponent(event.id)}`} aria-label={`Details zu ${event.name}`} className="shrink-0 rounded-md bg-accent-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-accent-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600">{Number(event.ticketPrice) === 0 ? "Kostenlos" : `${Number(event.ticketPrice).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${event.currency}`} <span aria-hidden="true">›</span></Link>}</div>
        </div>
      </article>)}
    </div>
    {!visible.length && <div className="rounded-xl border border-dashed border-zinc-300 px-6 py-16 text-center"><h2 className="font-semibold">{events.length ? "Keine passenden Events gefunden" : "Noch keine veröffentlichten Events"}</h2><p className="mt-2 text-sm text-zinc-500">{events.length ? "Versuche einen anderen Suchbegriff oder wähle eine andere Stadt." : "Schau bald wieder vorbei."}</p></div>}
  </main>;
}
