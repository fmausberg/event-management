"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteImportPersonalData } from "../../import/actions";

export function EraseImportData({ slug, importId }: { slug: string; importId: string }) {
  const [pending,start] = useTransition();
  const [error,setError] = useState("");
  const router = useRouter();
  return <form action={form => start(async () => {
    setError("");
    try {
      const result = await deleteImportPersonalData(slug,importId,form);
      if (result.error) setError(result.error); else router.refresh();
    } catch { setError("Die Importdaten konnten nicht gelöscht werden. Bitte erneut versuchen."); }
  })} className="space-y-3 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
    <h2 className="font-semibold">Personenbezogene Importdaten löschen</h2>
    <p className="text-sm">Entfernt unwiderruflich Rohzellen, normalisierte Zeilen, Mapping, Datei-/Blattname und Quellenbezeichnung. Bestehende Buchungen und unveränderliche Preis-Snapshots werden nicht gelöscht. Der Lauf bleibt mit Ergebnissen und Buchungsverknüpfungen nachvollziehbar.</p>
    {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
    <fieldset disabled={pending} className="space-y-3"><legend className="sr-only">Löschen bestätigen</legend>
      <label className="flex gap-2 text-sm"><input required type="checkbox" name="confirmed" value="yes" />Ich bestätige das endgültige Löschen der personenbezogenen Importdaten.</label>
      <button className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-700 disabled:opacity-40 dark:text-red-300">{pending ? "Importdaten werden gelöscht …" : "Importdaten endgültig löschen"}</button>
    </fieldset>
  </form>;
}
