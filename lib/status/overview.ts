import "server-only";
import { v2 as cloudinary } from "cloudinary";
import { getPrisma } from "@/lib/db/prisma";
import { getStripe } from "@/lib/payments/stripe";
import { verifyMailConnection } from "@/lib/mail";
import { configuration as eventbriteConfiguration } from "@/lib/eventbrite/connection";

export type ServiceState = "healthy" | "slow" | "timeout" | "denied" | "error" | "unconfigured" | "unchecked" | "disabled";
export type ServiceStatus = { name: string; state: ServiceState; detail: string; durationMs?: number };
const TIMEOUT = 8_000;
const TTL = 30_000;

export async function probe(name: string, configured: boolean, detail: string, check: () => Promise<unknown>): Promise<ServiceStatus> {
  if (!configured) return { name, state: "unconfigured", detail: "Zugangsdaten fehlen oder sind unvollständig." };
  const start = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(check),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("STATUS_TIMEOUT")), TIMEOUT); }),
    ]);
    const durationMs = Date.now() - start;
    return { name, state: durationMs >= 2_000 ? "slow" : "healthy", detail, durationMs };
  } catch (error) {
    // Never return provider messages, credentials, account data or user counts.
    const data = error && typeof error === "object" ? error as Record<string, unknown> : {};
    const code = data.statusCode ?? data.http_code;
    const timeout = data.message === "STATUS_TIMEOUT" || ["ETIMEDOUT", "ESOCKETTIMEDOUT"].includes(String(data.code));
    const denied = code === 401 || code === 403 || data.code === "EAUTH";
    return { name, state: timeout ? "timeout" : denied ? "denied" : "error", durationMs: Date.now() - start,
      detail: timeout ? "Keine rechtzeitige Antwort; der Zustand ist unklar." : denied ? "Authentifizierung oder Berechtigung fehlgeschlagen." : code === 429 ? "API-Anfragelimit erreicht. Später erneut prüfen." : "Prüfung fehlgeschlagen. Verbindung und Konfiguration prüfen." };
  } finally {
    clearTimeout(timer);
  }
}

const has = (...keys: string[]) => keys.every(key => !!process.env[key]?.trim());
function configurationStatus(name: string, configured: boolean, detail: string): ServiceStatus {
  return { name, state: configured ? "unchecked" : "unconfigured", detail: configured ? detail : "Nicht oder unvollständig konfiguriert." };
}

async function collect() {
  const services = await Promise.all([
    probe("Datenbank", has("DATABASE_URL"), "Verbindung und Lesen der User-Anzahl erfolgreich (auch bei 0 Usern). Schreibzugriff nicht geprüft.", () => getPrisma().user.count()),
    probe("Cloudinary", has("CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"), "Authentifizierter API-Ping erfolgreich. Uploads und Bildauslieferung nicht geprüft.", async () => {
      const result = await cloudinary.api.ping({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET, timeout: 7_000 });
      if (result.status !== "ok") throw new Error("Unexpected ping response");
    }),
    probe("Stripe", has("STRIPE_SECRET_KEY"), "Plattform-API erreichbar und authentifiziert. Connected Accounts, Webhooks und Zahlungen nicht geprüft.", () => getStripe().balance.retrieve({}, { timeout: 7_000, maxNetworkRetries: 0 })),
    probe("Mailversand (SMTP)", has("SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD"), "SMTP-Verbindung, TLS und Login erfolgreich. Keine Testmail versendet; Zustellung nicht geprüft.", () => verifyMailConnection(7_000)),
  ]);
  let eventbriteConfigured = false;
  try { eventbriteConfiguration(); eventbriteConfigured = true; } catch { /* Configuration only; no company tokens used. */ }
  services.push(
    process.env.IMAP_ARCHIVE_ENABLED === "false"
      ? { name: "Mailarchiv (IMAP)", state: "disabled", detail: "Archivierung gesendeter Mails ist deaktiviert." }
      : configurationStatus("Mailarchiv (IMAP)", has("IMAP_USER", "IMAP_PASSWORD") || (process.env.SMTP_HOST === "smtp.strato.de" && (!process.env.IMAP_HOST?.trim() || process.env.IMAP_HOST === "imap.strato.de") && !process.env.IMAP_USER?.trim() && !process.env.IMAP_PASSWORD && has("SMTP_USER", "SMTP_PASSWORD")), "Zugangsdaten vorhanden. Login, Archivordner und Schreibrechte nicht geprüft."),
    configurationStatus("Eventbrite", eventbriteConfigured, "App-Konfiguration gültig. OAuth und Unternehmensverbindungen nicht geprüft."),
    configurationStatus("Google-Login", has("AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"), "Zugangsdaten vorhanden. Ein vollständiger OAuth-Login ist für eine Funktionsprüfung nötig."),
    configurationStatus("GitHub-Login", has("AUTH_GITHUB_ID", "AUTH_GITHUB_SECRET"), "Zugangsdaten vorhanden. Ein vollständiger OAuth-Login ist für eine Funktionsprüfung nötig."),
  );
  return { services, checkedAt: new Date().toISOString() };
}

// Per-process cache and in-flight deduplication limit provider calls on this public page.
let cached: Awaited<ReturnType<typeof collect>> | undefined;
let expiresAt = 0;
let pending: ReturnType<typeof collect> | undefined;
export async function getStatusOverview() {
  if (cached && Date.now() < expiresAt) return cached;
  if (!pending) pending = collect().then(result => {
    cached = result;
    expiresAt = Date.now() + TTL;
    return result;
  }).finally(() => { pending = undefined; });
  return pending;
}
