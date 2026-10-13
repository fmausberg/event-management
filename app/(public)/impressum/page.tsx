import type { Metadata } from "next";
import { SiteFrame } from "@/components/site-frame";
export const metadata: Metadata = { title: "Impressum | Event-Management" };
export default function ImpressumPage() {
    return <SiteFrame><main className="mx-auto w-full max-w-6xl flex-1 px-5 py-12 sm:px-8">
        <h1 className="text-3xl font-semibold">Impressum</h1>
        <div className="mt-8 max-w-2xl space-y-8 leading-relaxed">
            <section><h2 className="text-lg font-semibold">Anbieter</h2>
                <address className="mt-3 not-italic">Felix Mausberg<br />Breite Straße 33a<br />41460 Neuss<br />Deutschland</address></section>
            <section><h2 className="text-lg font-semibold">Kontakt</h2><p className="mt-3">E-Mail: <a href="mailto:felix.mausberg@gmail.com" className="text-violet-700 underline underline-offset-4 dark:text-violet-300">felix.mausberg@gmail.com</a></p></section>
        </div>
    </main></SiteFrame>;
}
