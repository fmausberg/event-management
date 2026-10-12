"use client";

import { useActionState } from "react";
import { login, register } from "@/app/auth-actions";
import type { AuthFormState } from "@/lib/auth/validation";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const registering = mode === "register";
  const [state, action, pending] = useActionState<AuthFormState, FormData>(registering ? register : login, {});
  const fields = [
    ...(registering ? [{ name: "name" as const, label: "Name", type: "text", autoComplete: "name" }] : []),
    { name: "email" as const, label: "E-Mail-Adresse", type: "email", autoComplete: "email" },
    { name: "password" as const, label: "Passwort", type: "password", autoComplete: registering ? "new-password" : "current-password" },
    ...(registering ? [{ name: "confirmPassword" as const, label: "Passwort wiederholen", type: "password", autoComplete: "new-password" }] : []),
  ];
  return (
    <form action={action} className="space-y-5">
      {state.message && <p role="alert" className="rounded-lg border border-red-300 p-3 text-sm text-red-700 dark:border-red-900 dark:text-red-400">{state.message}</p>}
      {fields.map((field) => (
        <div key={field.name}>
          <label htmlFor={field.name} className="mb-2 block text-sm font-medium">{field.label}</label>
          <input name={field.name} type={field.type} autoComplete={field.autoComplete} id={field.name} required disabled={pending}
            maxLength={field.name === "email" ? 254 : field.name === "name" ? 100 : undefined}
            aria-invalid={!!state.errors?.[field.name]?.length}
            aria-describedby={state.errors?.[field.name] ? `${field.name}-error` : undefined}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none focus:ring-2 focus:ring-zinc-500 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950" />
          {state.errors?.[field.name] && <p id={`${field.name}-error`} role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">{state.errors[field.name]?.join(" ")}</p>}
        </div>
      ))}
      <button disabled={pending} className="w-full rounded-lg bg-zinc-900 px-4 py-3 font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
        {pending ? "Bitte warten …" : registering ? "Konto erstellen" : "Anmelden"}
      </button>
    </form>
  );
}
