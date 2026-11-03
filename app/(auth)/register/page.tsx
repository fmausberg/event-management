import type { Metadata } from "next";
import { AuthPage } from "@/components/auth-page";
import { SiteFrame } from "@/components/site-frame";

export const metadata: Metadata = { title: "Veranstaltungsverwaltung" };
export default function RegisterPage() { return <SiteFrame><AuthPage mode="register" /></SiteFrame>; }
