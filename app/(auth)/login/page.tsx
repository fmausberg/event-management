import type { Metadata } from "next";
import { AuthPage } from "@/components/auth-page";

export const metadata: Metadata = { title: "Anmelden | Eventverwaltung" };
export default async function LoginPage({ searchParams }: {
  searchParams: Promise<{ error?: string | string[]; registered?: string | string[] }>;
}) {
  const params = await searchParams;
  return <AuthPage mode="login" error={typeof params.error === "string" ? params.error : undefined} registered={params.registered === "1"} />;
}
