import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { SiteFrame } from "@/components/site-frame";
import { VerificationForm } from "./verification-form";
export const metadata = { title: "E-Mail bestätigen", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default async function VerifyEmailPage() {
 if ((await auth())?.user?.id) redirect("/account");
 return <SiteFrame><main className="mx-auto w-full max-w-lg flex-1 p-6 sm:p-10"><h1 className="text-2xl font-semibold">E-Mail bestätigen</h1><VerificationForm /></main></SiteFrame>;
}
