"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";

export function RefreshStatusButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <button type="button" disabled={pending} onClick={() => startTransition(() => router.refresh())} className="self-start rounded-lg border border-zinc-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-zinc-700">{pending ? "Wird aktualisiert …" : "Status aktualisieren"}</button>;
}
