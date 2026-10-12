import type { Metadata } from "next";
import { AuthPage } from "@/app/_components/auth-page";

export const metadata: Metadata = { title: "Registrieren | Eventverwaltung" };
export default function RegisterPage() { return <AuthPage mode="register" />; }
