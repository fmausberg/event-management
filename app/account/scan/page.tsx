import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { TicketScanner } from "./ticket-scanner";
export const metadata = { title: "Eventverwaltung", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default async function ScanPage() {
 if (!(await auth())?.user?.id) redirect("/login");
 return <TicketScanner />;
}
