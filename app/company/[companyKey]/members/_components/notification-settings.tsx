"use client";

import { useState, useTransition } from "react";
import { changeMemberNotifications } from "../actions";

export function NotificationSettings({ companySlug, membershipId, email, setting, checked, canManage }: {
  companySlug: string; membershipId: string; email: string;
  setting: "notifyBookings" | "notifyCancellationRequests";
  checked: boolean; canManage: boolean;
}) {
  const [enabled, setEnabled] = useState(checked);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const label = setting === "notifyBookings" ? "Buchungsbenachrichtigung" : "Stornierungsanfragebenachrichtigung";
  function save(next: boolean) {
    setEnabled(next);
    setError(undefined);
    const data = new FormData();
    data.set("setting", setting);
    data.set("enabled", String(next));
    startTransition(async () => {
      try {
        const result = await changeMemberNotifications(companySlug, membershipId, {}, data);
        if (result.success) return;
        setError(result.message ?? "Speichern fehlgeschlagen.");
      } catch {
        setError("Speichern fehlgeschlagen. Bitte erneut versuchen.");
      }
      setEnabled(!next);
    });
  }
  return <>
    <input type="checkbox" checked={enabled} disabled={!canManage || pending}
      aria-label={`${label} für ${email}`} aria-busy={pending}
      onChange={event => save(event.target.checked)} />
    {pending && <span role="status" className="sr-only">Wird gespeichert …</span>}
    {error && <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-300">{error}</p>}
  </>;
}
