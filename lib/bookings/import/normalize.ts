import { ImportError } from "./errors";
import { z } from "zod";
import { parseBerlinDateTime } from "@/lib/events/berlin-date-time";
import { fields, type Cell, type Field, type Mapping, type Normalized, type Sheet } from "./types";

const aliases: Record<Field, string[]> = {
  eventTitle: ["Eventtitel", "Event", "Event Title"], eventDate: ["Veranstaltungsdatum", "Eventdatum", "Event Date"],
  location: ["Location", "Venue"], externalId: ["Externe ID", "Buchungs-ID", "Booking ID", "Order ID"],
  firstName: ["Käufer Vorname", "Vorname", "First Name"], lastName: ["Käufer Nachname", "Nachname", "Last Name"],
  name: ["Name", "Vollständiger Name", "Customer Name"], email: ["Email Adresse", "E-Mail", "Email"],
  quantity: ["Anzahl Tickets", "Ticketanzahl", "Quantity"], bookedAt: ["Kaufdatum", "Buchungsdatum", "Booking Date"],
  gross: ["Summe in € (Brutto)", "Bruttogesamtbetrag", "Gross Total"], currency: ["Währung", "Currency"],
  refund: ["Erstatteter Betrag Brutto", "Erstattungsbetrag", "Refund Amount"], refundedAt: ["Erstattungsdatum", "Refund Date"],
  externalStatus: ["Buchungsstatus", "Zahlungsstatus", "Status", "Payment Status"],
};
const canonical = (s: string) => s.trim().toLocaleLowerCase("de-DE").replace(/\s+/g, " ");
export function suggestMapping(headers: string[]): Mapping {
  return Object.fromEntries((Object.keys(fields) as Field[]).flatMap(key => {
    const matches = headers.filter(h => aliases[key].some(a => canonical(a) === canonical(h)));
    return matches.length === 1 ? [[key, matches[0]]] : [];
  }));
}

/** All monetary columns use major currency units, never infer cents from magnitude. */
export function money(value: Cell): number {
  let s = String(value ?? "").trim().replace(/\s|\u00a0/g, "").replace(/€|EUR/gi, "");
  if (s.includes(",")) {
    if (!/^\d{1,3}(\.\d{3})*,\d{1,2}$|^\d+,\d{1,2}$/.test(s)) throw new ImportError("Ungültiger Geldbetrag; z. B. 39 €, 3,70 oder 6.23 verwenden.");
    s = s.replaceAll(".", "").replace(",", ".");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new ImportError("Geldbetrag muss positiv oder null sein und höchstens zwei Nachkommastellen haben (keine Cent-Schreibweise).");
  const [major, fraction = ""] = s.split(".");
  const result = Number(major) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result) || result > 2147483647) throw new ImportError("Geldbetrag ist zu groß.");
  return result;
}

export function dateValue(value: Cell, date1904 = false): string {
  let s = String(value ?? "").trim();
  if (!s) throw new ImportError("Datum fehlt.");
  if (typeof value === "number" || /^\d{5}(\.\d+)?$/.test(s)) {
    const serial = Number(value);
    if (!Number.isFinite(serial) || serial < (date1904 ? 0 : 1) || serial > 150000 || (!date1904 && serial >= 60 && serial < 61)) throw new ImportError("Ungültiges Excel-Datum.");
    s = new Date(Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : serial < 60 ? 31 : 30) + Math.round(serial * 86400000)).toISOString().slice(0,19);
  }
  if (/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d{1,3})?)?(Z|[+-]\d\d:\d\d)$/.test(s)) {
    const wall = s.slice(0,10);
    if (Number(s.slice(11,13)) > 23 || Number(s.slice(14,16)) > 59 || (s[16] === ":" && Number(s.slice(17,19)) > 59)) throw new ImportError("Ungültige Uhrzeit.");
    const calendar = new Date(`${wall}T00:00:00Z`);
    if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0,10) !== wall || Number(wall.slice(0,4)) < 1900 || Number(wall.slice(0,4)) > 2200) throw new ImportError("Ungültiges Datum.");
    const parsed = new Date(s);
    if (!Number.isFinite(parsed.getTime())) throw new ImportError("Ungültiges Datum.");
    return parsed.toISOString();
  }
  const de = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.000)?)?)?$/);
  if (!de && !iso) throw new ImportError("Datum bitte als TT.MM.JJJJ, optional HH:mm, angeben.");
  const parts = de ? [Number(de[3]), Number(de[2]), Number(de[1]), Number(de[4] ?? 0), Number(de[5] ?? 0), Number(de[6] ?? 0)] : iso!.slice(1).map(v => Number(v ?? 0));
  const [y,m,d,h,min,sec] = parts;
  if (y < 1900 || y > 2200) throw new ImportError("Datum liegt außerhalb des unterstützten Bereichs (1900–2200).");
  const target = `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}T${String(h).padStart(2,"0")}:${String(min).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
  return parseBerlinDateTime(target).toISOString();
}

export function normalizeRow(raw: Record<string, Cell>, mapping: Mapping, date1904 = false) {
  const text = (key: Field) => String(raw[mapping[key] ?? ""] ?? "").trim();
  const errors: string[] = [], warnings: string[] = [];
  function parsed<T>(label: string, work: () => T, fallback: T): T {
    try { return work(); } catch (e) { errors.push(`${label}: ${e instanceof Error ? e.message : "Ungültiger Wert."}`); return fallback; }
  }
  const date = (key: Field, required = false) => !text(key) && !required ? null : parsed(fields[key], () => dateValue(raw[mapping[key] ?? ""], date1904), null as string | null);
  const amount = (key: Field, required = false) => !text(key) && !required ? null : parsed(fields[key], () => money(raw[mapping[key] ?? ""]), null as number | null);
  const quantity = Number(text("quantity"));
  if (!/^\d+$/.test(text("quantity")) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 2147483647) errors.push("Ticketanzahl muss eine positive ganze Zahl sein.");
  const email = text("email") || null;
  if (email && (!z.email().safeParse(email).success || email.length > 254)) errors.push("E-Mail-Adresse ist ungültig.");
  const name = text("name") || [text("firstName"), text("lastName")].filter(Boolean).join(" ") || null;
  const composedName = [text("firstName"), text("lastName")].filter(Boolean).join(" ");
  if (text("name") && composedName && canonical(text("name")) !== canonical(composedName)) warnings.push("Vollständiger Name weicht von Vor-/Nachname ab; der vollständige Name wird verwendet.");
  if (name && name.length > 255) errors.push("Name ist zu lang (maximal 255 Zeichen).");
  if (!name && !email) warnings.push("Name und E-Mail fehlen.");
  const externalId = text("externalId") || null;
  if (externalId && externalId.length > 191) errors.push("Externe ID ist zu lang (maximal 191 Zeichen).");
  if (!externalId) warnings.push("Keine externe ID: Ein erneuter Import kann weitere Buchungen erzeugen.");
  let currency = text("currency").toUpperCase() || "EUR";
  if (!/^[A-Z]{3}$/.test(currency)) errors.push("Währung muss ein dreistelliger ISO-Code sein.");
  else { try {
    if (!Intl.supportedValuesOf("currency").includes(currency)) errors.push("Unbekannte Währung.");
    else if (new Intl.NumberFormat("de-DE", { style: "currency", currency }).resolvedOptions().maximumFractionDigits !== 2) errors.push("Diese Währung hat nicht zwei Minor-Unit-Stellen und wird im MVP noch nicht unterstützt.");
  } catch { currency = "EUR"; errors.push("Währung kann nicht geprüft werden."); } }
  const gross = amount("gross", true), refund = amount("refund"), refundedAt = date("refundedAt");
  if (currency !== "EUR" && [text("gross"), text("refund")].some(v => /€|EUR/i.test(v))) errors.push("Euro-Betrag widerspricht der angegebenen Währung.");
  const externalStatus = text("externalStatus") || null;
  const statusMap: Record<string, Normalized["status"]> = { confirmed: "CONFIRMED", bestätigt: "CONFIRMED", paid: "CONFIRMED", bezahlt: "CONFIRMED", cancelled: "CANCELLED", canceled: "CANCELLED", storniert: "CANCELLED", pending_payment: "PENDING_PAYMENT", "zahlung ausstehend": "PENDING_PAYMENT", expired: "EXPIRED", abgelaufen: "EXPIRED" };
  let status: Normalized["status"] = "CONFIRMED";
  const refundStatuses = new Set(["refunded", "partially_refunded", "partially refunded", "fully_refunded", "fully refunded", "erstattet", "teilweise erstattet", "vollständig erstattet"]);
  const statusKey = canonical(externalStatus ?? "");
  const refunded = !!refundedAt || (refund ?? 0) > 0 || refundStatuses.has(statusKey);
  if (externalStatus && !statusMap[statusKey] && !refundStatuses.has(statusKey)) errors.push("Externer Status ist unbekannt. Spaltenmapping entfernen oder Quellwert korrigieren.");
  if (refunded) warnings.push("Externe Erstattung: separat dokumentiert. Status bleibt bestätigt und Plätze bleiben belegt; keine interne Stornierung oder Stripe-Erstattung.");
  else if (externalStatus) {
    const mapped = statusMap[statusKey];
    if (mapped) status = mapped;
  }
  if (refund != null && gross != null && refund > gross) errors.push("Erstattung übersteigt den Bruttogesamtbetrag.");
  if (refundedAt && !refund) warnings.push("Erstattungsdatum ohne positiven Erstattungsbetrag.");
  if (status === "PENDING_PAYMENT") warnings.push("Ausstehende externe Zahlung reserviert Plätze ohne automatische Ablaufzeit.");
  const normalized: Normalized = {
    eventTitle: text("eventTitle"), eventDate: date("eventDate"), location: text("location"), eventId: null,
    externalId, customerName: name, customerEmail: email, quantity: Number.isSafeInteger(quantity) ? quantity : 0,
    bookedAt: date("bookedAt", true), gross: gross ?? 0, currency, refund, refundedAt, externalStatus, status,
  };
  return { normalized, errors, warnings };
}

// The source date is part of the key even if invalid; invalid dates never silently collapse into another group.
export function groupKey(raw: Record<string, Cell>, mapping: Mapping) {
  return JSON.stringify([String(raw[mapping.eventTitle ?? ""] ?? "").trim(), String(raw[mapping.eventDate ?? ""] ?? "").trim()]);
}
export function validateMapping(mapping: Mapping, sheet: Sheet) {
  const selected = Object.entries(mapping).filter(([,v]) => v);
  if (selected.some(([k,v]) => !(k in fields) || !sheet.headers.includes(v!)) || new Set(selected.map(([,v]) => v)).size !== selected.length) throw new ImportError("Spaltenzuordnung ist ungültig oder mehrfach verwendet.");
  for (const field of ["quantity", "bookedAt", "gross"] as const) if (!mapping[field]) throw new ImportError(`Bitte „${fields[field]}“ zuordnen.`);
}
