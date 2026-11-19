export const fields = {
  eventTitle: "Eventtitel", eventDate: "Veranstaltungsdatum / Uhrzeit", location: "Location (Hinweis)",
  externalId: "Buchungs-ID / externe ID", firstName: "Vorname", lastName: "Nachname", name: "Vollständiger Name",
  email: "E-Mail", quantity: "Ticketanzahl", bookedAt: "Buchungsdatum", gross: "Bruttogesamtbetrag (Haupteinheit, z. B. Euro)",
  currency: "Währung (ISO-Code)", refund: "Erstattungsbetrag", refundedAt: "Erstattungsdatum", externalStatus: "Externer Buchungs-/Zahlungsstatus",
} as const;
export type Field = keyof typeof fields;
export type Mapping = Partial<Record<Field, string>>;
export type Cell = string | number | boolean | null;
export type Sheet = { name: string; date1904?: boolean; headers: string[]; rows: { sourceRow: number; raw: Record<string, Cell> }[] };
export type ImportFile = { sheets: Sheet[] };
export type ImportConfig = {
  requestId: string; sheet: string; platform: string; name: string; mapping: Mapping;
  events: Record<string, string>; excluded: number[];
};
export type Normalized = {
  eventTitle: string; eventDate: string | null; location: string; eventId: string | null;
  externalId: string | null; customerName: string | null; customerEmail: string | null;
  quantity: number; bookedAt: string | null; gross: number; currency: string;
  refund: number | null; refundedAt: string | null; externalStatus: string | null;
  status: "CONFIRMED" | "CANCELLED" | "PENDING_PAYMENT" | "EXPIRED";
};
export type PreviewRow = {
  sourceRow: number; group: string; normalized: Normalized; eventName: string | null;
  state: "READY" | "WARNING" | "ERROR" | "DUPLICATE" | "EXCLUDED";
  errors: string[]; warnings: string[];
};
export type EventChoice = { id: string; name: string; beginsAt: string | null; location: string | null };
export type EventGroup = { key: string; title: string; date: string | null; location: string; candidates: { id: string; score: number }[] };
export type Preview = { hash: string; rows: PreviewRow[]; groups: EventGroup[]; events: EventChoice[]; capacity: string[]; canCommit: boolean };
export const limits = { bytes: 5 * 1024 * 1024, rows: 1000, columns: 80, sheets: 10, rowBytes: 24 * 1024, totalJsonBytes: 6 * 1024 * 1024 };
