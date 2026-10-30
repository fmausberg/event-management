"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { loadReview, updateReview, updateReviewRating } from "./actions";

type Review = Extract<Awaited<ReturnType<typeof loadReview>>, { state: "open" }>;
const categories = [
  ["overall", "Gesamtbewertung"], ["trainer", "Trainer"], ["location", "Location"], ["organization", "Organisation und Kommunikation"],
] as const;
const button = "rounded-lg bg-primary-600 px-4 py-3 text-white disabled:opacity-50";
export function ReviewForm() {
  const [token, setToken] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [state, setState] = useState("loading");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [unsavedRatings, setUnsavedRatings] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(window.location.hash.slice(1));
    const bearer = params.get("token") ?? "";
    const selected = Number(params.get("rating"));
    // The fragment stays out of GET requests; persist its rating through a POST.
    loadReview(bearer).then(async result => {
      if (!active) return;
      setToken(bearer); setState(result.state);
      if (result.state === "open") {
        setReview({ ...result, overallRating: Number.isInteger(selected) && selected >= 1 && selected <= 5 ? selected : result.overallRating });
        setMessage("Sterne werden automatisch gespeichert. Kommentare werden beim Absenden übernommen.");
        if (Number.isInteger(selected) && selected >= 1 && selected <= 5) {
          setBusy(true);
          setUnsavedRatings(["overallRating"]);
          try {
            const saved = await updateReviewRating(bearer, "overallRating", selected);
            if (!active) return;
            if (saved.state === "saved") { setUnsavedRatings([]); setMessage("Vorläufig gespeichert – du kannst deine Bewertung weiter ändern."); }
            else if (saved.state === "error") setMessage(saved.message);
            else setState(saved.state);
          } catch { if (active) setMessage("Speichern fehlgeschlagen. Bitte klicke erneut auf den gewünschten Stern."); }
          finally { if (active) setBusy(false); }
        }
      }
    }).catch(() => { if (active) setState("error"); });
    return () => { active = false; };
  }, []);

  async function selectRating(field: "overallRating" | "trainerRating" | "locationRating" | "organizationRating", value: number | null) {
    if (!review || busy) return;
    setReview({ ...review, [field]: value });
    setUnsavedRatings(current => [...current.filter(key => key !== field), field]);
    setBusy(true);
    setMessage("Sterne werden gespeichert …");
    try {
      const result = await updateReviewRating(token, field, value);
      if (result.state === "saved") { setUnsavedRatings(current => current.filter(key => key !== field)); setMessage("Vorläufig gespeichert. Kommentare werden erst beim Absenden übernommen."); }
      else if (result.state === "error") setMessage(result.message);
      else setState(result.state);
    } catch { setMessage("Speichern fehlgeschlagen. Bitte klicke erneut auf den gewünschten Stern."); }
    finally { setBusy(false); }
  }

  async function submit() {
    if (!review || busy || unsavedRatings.length > 0) return;
    setBusy(true);
    try {
      const result = await updateReview(token, review, true);
      if (result.state === "saved") setMessage("Vorläufig gespeichert – noch nicht endgültig abgesendet. Du kannst deine Bewertung weiter ändern.");
      else if (result.state === "error") setMessage(result.message);
      else setState(result.state);
    } catch { setMessage("Speichern gerade nicht möglich. Bitte versuche es erneut; deine Eingaben bleiben erhalten."); }
    finally { setBusy(false); }
  }
  if (state === "loading") return <p role="status">Bewertung wird geladen …</p>;
  if (state === "completed") return <><h1 className="text-2xl font-semibold">Vielen Dank!</h1><p className="my-5">Deine Bewertung ist eingegangen und abgeschlossen.</p><Link href="/events" className="underline">Zu den Events</Link></>;
  if (state === "invalid") return <><h1 className="text-2xl font-semibold">Dieser Bewertungslink ist nicht verfügbar</h1><p className="my-5">Der Link ist ungültig, abgelaufen oder das Event ist noch nicht beendet. Bitte prüfe den Link aus deiner E-Mail.</p><Link href="/events" className="underline">Zu den Events</Link></>;
  if (!review || state === "error") return <p role="alert">Die Bewertung konnte nicht geladen werden. Bitte lade die Seite erneut.</p>;
  return <>
    <h1 className="text-2xl font-semibold">Wie war {review.eventName}?</h1>
    {review.date && <p className="mt-2 text-zinc-500">{new Intl.DateTimeFormat("de-DE", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Berlin" }).format(new Date(review.date))}</p>}
    <p className="my-5">Dein Feedback bleibt intern. Detailbewertungen und Kommentare sind freiwillig.</p>
    <form onSubmit={event => { event.preventDefault(); void submit(); }} className="space-y-6">
      <fieldset disabled={busy} className="space-y-6">
        {categories.filter(([key]) => key !== "trainer" || review.hasTrainer).map(([key, label]) => {
          const ratingKey = `${key}Rating` as const;
          const commentKey = `${key}Comment` as const;
          const value = review[ratingKey];
          return <fieldset key={key} className="rounded-xl border border-zinc-300 p-4 dark:border-zinc-700">
            <legend className="px-1 font-semibold">{label}{key !== "overall" && " (optional)"}</legend>
            <div className="flex flex-wrap items-center gap-1">
              {[1, 2, 3, 4, 5].map(star => <label key={star} className="relative cursor-pointer p-2 text-3xl">
                <input type="radio" name={ratingKey} value={star} checked={value === star} required={key === "overall"}
                  onClick={() => void selectRating(ratingKey, star)} onChange={() => {}}
                  className="peer sr-only" aria-label={`${star} von 5 Sternen`} />
                <span aria-hidden="true" className={`${value && star <= value ? "text-accent-500" : "text-zinc-400"} peer-focus-visible:outline peer-focus-visible:outline-2`}>★</span>
              </label>)}
            </div>
            <p className="text-sm">{value ? `${value} von 5 Sternen` : "Nicht bewertet"}</p>
            {key !== "overall" && <button type="button" className="mt-2 text-sm underline" onClick={() => void selectRating(ratingKey, null)}>Nicht bewerten</button>}
            <label className="mt-4 block text-sm">Kommentar zu {label} (optional, maximal 2000 Zeichen)
              <textarea maxLength={2000} rows={3} value={review[commentKey] ?? ""} onChange={event => { setReview({ ...review, [commentKey]: event.target.value }); setMessage("Kommentar geändert – wird beim Absenden gespeichert."); }} className="mt-2 w-full rounded-lg border border-zinc-300 bg-transparent p-3 dark:border-zinc-700" />
            </label>
          </fieldset>;
        })}
      </fieldset>
      <p role="status" aria-live="polite">{message}</p>
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={busy || unsavedRatings.length > 0 || !review.overallRating} className={button}>Bewertung absenden</button>
      </div>
      <p className="text-sm text-zinc-500">Nur „Bewertung absenden“ schließt die Bewertung ab und sperrt weitere Änderungen.</p>
    </form>
  </>;
}
