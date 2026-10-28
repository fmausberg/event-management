import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/lib/db/prisma";
import { seriesSchema, type SeriesState } from "./validation";
import { seriesLabels, type SeriesAttribute, type SeriesPreview } from "./preview";
import { cancellationPolicyText } from "@/lib/cancellations/policy";
import { uploadEventImage, deleteEventImage, type UploadedEventImage } from "@/lib/events/images";

type Fields = Omit<z.output<typeof seriesSchema>, "imageUrl"> & { imageUrl?: string | null; suggestedTrainerName: null };
const include = { trainers: { include: { trainer: true }, orderBy: { trainerId: "asc" as const } }, venue: true };
type Event = Prisma.EventGetPayload<{ include: typeof include }>;
export class SeriesConflict extends Error {
  constructor(message = "Die Serie oder ihre Events wurden inzwischen geändert oder ein Event hat begonnen. Bitte lade die Seite neu und prüfe die Änderungen erneut.") { super(message); }
}
function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function signature(value: string) {
  if (!process.env.AUTH_SECRET) throw new Error("AUTH_SECRET is required");
  return createHmac("sha256", process.env.AUTH_SECRET).update(`series-preview:${value}`).digest("hex");
}
function token(hash: string) { const body = `${Date.now() + 3600000}:${hash}`; return `${body}:${signature(body)}`; }
function verify(value: unknown, hash: string) {
  if (typeof value !== "string" || value.length > 256) throw new SeriesConflict();
  const [expires, expected, sig] = value.split(":");
  const actual = signature(`${expires}:${expected}`);
  if (Number(expires) < Date.now() || !Number.isFinite(Number(expires)) || expected !== hash || !sig || sig.length !== actual.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(actual))) throw new SeriesConflict();
}
const mapping = { name: "name", shortdescription: "shortdescription", description: "description", imageUrl: "imageUrl", suggestedMaxSeats: "maxSeats", suggestedTicketPrice: "ticketPrice", suggestedCurrency: "currency", suggestedVenueId: "venueId", suggestedFreeCancellationUntilMinutesBeforeStart: "freeCancellationUntilMinutesBeforeStart" } as const;
function normalized(value: unknown, key: SeriesAttribute) {
  return value == null ? null : key === "suggestedTicketPrice" ? new Prisma.Decimal(String(value)).toFixed(2) : value;
}
function eventValue(event: Event, key: SeriesAttribute): unknown {
  if (key === "suggestedDuration") return event.beginsAt && event.endsAt ? (event.endsAt.getTime() - event.beginsAt.getTime()) / 60000 : null;
  if (key === "suggestedTrainerId") return event.trainers.map((t) => t.trainerId);
  return normalized(event[mapping[key]], key);
}
function proposedValue(data: Fields, key: SeriesAttribute) { return key === "suggestedTrainerId" ? data.suggestedTrainerId ? [data.suggestedTrainerId] : [] : normalized(data[key], key); }
function format(value: unknown, key: SeriesAttribute, currency: string) {
  if (key === "suggestedFreeCancellationUntilMinutesBeforeStart") return cancellationPolicyText(value as number | null);
  if (value == null || value === "") return "—";
  if (key === "suggestedTicketPrice") return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(Number(value));
  if (key === "suggestedDuration") return `${value} Minuten`;
  if (key === "imageUrl" && String(value).startsWith("upload:")) return "Neues hochgeladenes Titelbild";
  return String(value);
}
async function snapshot(tx: Prisma.TransactionClient, companyId: string, id: string, fields: Fields) {
  const series = await tx.eventSeries.findFirst({ where: { id, companyId } });
  if (!series) throw new SeriesConflict("Diese Eventserie ist nicht verfügbar.");
  const data = { ...fields, imageUrl: fields.imageUrl === undefined ? series.imageUrl : fields.imageUrl };
  const keys = (Object.keys(seriesLabels) as SeriesAttribute[]).filter((key) => normalized(series[key], key) !== normalized(data[key], key));
  const events = await tx.event.findMany({ where: { companyId, eventSeriesId: id, beginsAt: { gt: new Date() } }, include, orderBy: [{ beginsAt: "asc" }, { id: "asc" }] });
  const venue = data.suggestedVenueId ? await tx.venue.findFirst({ where: { id: data.suggestedVenueId, companyId } }) : null;
  const trainer = data.suggestedTrainerId ? await tx.trainer.findFirst({ where: { id: data.suggestedTrainerId, companyId } }) : null;
  if (data.suggestedVenueId && !venue || data.suggestedTrainerId && !trainer) throw new SeriesConflict("Venue oder Trainer ist nicht mehr verfügbar.");
  const tabs: SeriesPreview["tabs"] = keys.map((key) => ({ key, label: seriesLabels[key], rows: events.filter((event) => JSON.stringify(eventValue(event, key)) !== JSON.stringify(proposedValue(data, key)) || key === "suggestedTrainerId" && !!event.trainerName).map((event) => ({
    id: event.id,
    date: new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", dateStyle: "medium", timeStyle: "short" }).format(event.beginsAt!),
    before: key === "suggestedVenueId" ? event.venue?.name ?? "—" : key === "suggestedTrainerId" ? event.trainers.map(({ trainer: t }) => `${t.firstName} ${t.lastName}`).join(", ") || event.trainerName || "—" : format(eventValue(event, key), key, event.currency),
    after: key === "suggestedVenueId" ? venue?.name ?? "—" : key === "suggestedTrainerId" ? trainer ? `${trainer.firstName} ${trainer.lastName}` : "—" : format(proposedValue(data, key), key, key === "suggestedTicketPrice" ? event.currency : data.suggestedCurrency),
  })) }));
  return { series, data, events, tabs, hash: digest({ companyId, id, series, data, events }) };
}
const selectionSchema = z.record(z.string(), z.array(z.string().min(1).max(191))).refine((v) => Object.values(v).every((ids) => new Set(ids).size === ids.length));

export async function updateSeriesWithPreview(companyId: string, id: string, fields: Fields, file: File | null, form: FormData): Promise<SeriesState> {
  const db = getPrisma();
  if (file) fields.imageUrl = `upload:${createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex")}`;
  const initial = await snapshot(db, companyId, id, fields);
  const confirmation = form.get("seriesPreviewToken");
  if (!confirmation && initial.tabs.some((tab) => tab.rows.length)) return { preview: { token: token(initial.hash), tabs: initial.tabs } };
  if (confirmation) verify(confirmation, initial.hash);
  const selection = confirmation ? selectionSchema.parse(JSON.parse(String(form.get("seriesSelection")))) : {};
  for (const [key, ids] of Object.entries(selection)) {
    const tab = initial.tabs.find((tab) => tab.key === key);
    if (!tab || ids.some((id) => !tab.rows.some((row) => row.id === id))) throw new SeriesConflict("Die Event-Auswahl ist ungültig. Bitte erstelle die Vorschau erneut.");
  }
  let uploaded: UploadedEventImage | undefined;
  let saved = false;
  try {
    if (file) uploaded = await uploadEventImage(companyId, file);
    await db.$transaction(async (tx) => {
      const current = await snapshot(tx, companyId, id, fields);
      if (current.hash !== initial.hash) throw new SeriesConflict();
      const result = await tx.eventSeries.updateMany({ where: { id, companyId, updatedAt: current.series.updatedAt }, data: { ...fields, ...(uploaded ? { imageUrl: uploaded.imageUrl } : {}) } });
      if (result.count !== 1) throw new SeriesConflict();
      for (const event of current.events) {
        const selected = current.tabs.filter((tab) => selection[tab.key]?.includes(event.id)).map((tab) => tab.key);
        if (!selected.length) continue;
        const data: Prisma.EventUncheckedUpdateManyInput = {};
        for (const key of selected) {
          if (key === "suggestedDuration") {
            data.endsAt = fields.suggestedDuration === null ? null : new Date(event.beginsAt!.getTime() + fields.suggestedDuration * 60000);
            if (data.endsAt && data.endsAt.getUTCFullYear() > 9999) throw new SeriesConflict("Die Dauer ergibt ein ungültiges Event-Ende.");
          } else if (key === "suggestedTrainerId") data.trainerName = null;
          else if (key === "imageUrl") { data.imageUrl = uploaded?.imageUrl ?? fields.imageUrl; data.imagePublicId = null; }
          else Object.assign(data, { [mapping[key]]: fields[key] });
        }
        // Preserve the same required fields as the published-event editor.
        if (event.status === "PUBLISHED" && (data.endsAt === null || data.maxSeats === null || data.ticketPrice === null || data.venueId === null || data.shortdescription === null)) throw new SeriesConflict("Ein veröffentlichtes Event benötigt Kurzbeschreibung, Ende, Teilnehmerzahl, Ticketpreis und Venue. Bitte wähle es beim Leeren dieser Vorgabe ab.");
        const updated = await tx.event.updateMany({ where: { id: event.id, companyId, eventSeriesId: id, updatedAt: event.updatedAt, beginsAt: { gt: new Date() } }, data });
        if (updated.count !== 1) throw new SeriesConflict();
        if (selected.includes("suggestedTrainerId")) {
          await tx.eventTrainer.deleteMany({ where: { eventId: event.id } });
          if (fields.suggestedTrainerId) await tx.eventTrainer.createMany({ data: [{ eventId: event.id, trainerId: fields.suggestedTrainerId }] });
        }
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    saved = true;
    return { success: true, message: "Eventserie und ausgewählte Event-Attribute wurden gespeichert." };
  } finally { if (uploaded && !saved) await deleteEventImage(uploaded.imagePublicId); }
}
