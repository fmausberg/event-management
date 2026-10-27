import { z } from "zod";

export const cancellationMinutes = z.string().trim().default("").refine(
  (value) => value === "" || /^\d+$/.test(value) && Number(value) <= 2147483647,
  "Bitte eine nicht negative ganze Anzahl Minuten angeben.",
).transform((value) => value === "" ? null : Number(value));

export function cancellationPolicy(beginsAt: Date | null, minutes: number | null, now = new Date()) {
  const started = !!beginsAt && beginsAt.getTime() <= now.getTime();
  const deadline = beginsAt && minutes != null ? new Date(beginsAt.getTime() - minutes * 60_000) : null;
  return { started, deadline, free: !started && !!deadline && now.getTime() <= deadline.getTime() };
}

export function cancellationPolicyText(minutes: number | null | undefined) {
  if (minutes == null) return "Kostenfreie Selbststornierung deaktiviert. Eine Stornierungsanfrage ist vor Eventbeginn möglich.";
  const duration = minutes % 1440 === 0 && minutes > 0 ? `${minutes / 1440} Tag(en)` : minutes % 60 === 0 ? `${minutes / 60} Stunde(n)` : `${minutes} Minuten`;
  return `Kostenfreie Stornierung bis ${duration} vor Eventbeginn; danach ist eine Anfrage erforderlich. Nach Eventbeginn ist keine Stornierung möglich.`;
}

export const requestLabels = { PENDING: "Anfrage offen", APPROVED: "Stornierung genehmigt", REJECTED: "Anfrage abgelehnt", WITHDRAWN: "Anfrage zurückgezogen" };
export const refundLabels = { NONE: "Keine Online-Erstattung erforderlich", PENDING: "Erstattung ausstehend", SUCCEEDED: "Erstattung erfolgreich", FAILED: "Erstattung fehlgeschlagen", REVIEW: "Erstattung muss geprüft werden" };
