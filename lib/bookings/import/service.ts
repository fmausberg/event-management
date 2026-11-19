import { ImportError } from "./errors";
import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Platform, Prisma } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/auth";
import { getPrisma } from "@/lib/db/prisma";
import { requireCompanyAccess, requireCompanyAdmin } from "@/lib/companies/members";
import { withAuditContext } from "@/lib/audit/context";
import { normalizeRow, groupKey, validateMapping } from "./normalize";
import { fields, type ImportConfig, type Preview, type PreviewRow, type Sheet, type EventGroup } from "./types";

const configSchema = z.object({
  requestId: z.uuid(), sheet: z.string().min(1).max(160), platform: z.enum(Platform), name: z.string().trim().max(160),
  mapping: z.partialRecord(z.enum(Object.keys(fields) as [keyof typeof fields, ...(keyof typeof fields)[]]), z.string().max(255)),
  events: z.record(z.string().max(1000), z.string().max(191)).refine(v => Object.keys(v).length <= 1000),
  excluded: z.array(z.number().int().positive().max(100000)).max(1000),
});
export function parseConfig(input: unknown): ImportConfig {
  const result = configSchema.safeParse(input);
  if (!result.success) throw new ImportError("Importeinstellungen sind ungültig. Bitte Zuordnung und Quelle prüfen.");
  return result.data;
}

const cleanTitle = (s: string) => s.toLocaleLowerCase("de-DE").normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const dayFormatter = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" });
const localDay = (s: string) => dayFormatter.format(new Date(s));
function titleSimilarity(a: string, b: string) {
  const left = new Set(cleanTitle(a).split(" ").filter(Boolean)), right = new Set(cleanTitle(b).split(" ").filter(Boolean));
  const shared = [...left].filter(t => right.has(t)).length;
  return shared / Math.max(1, left.size + right.size - shared);
}
export async function buildPreview(companyId: string, sheet: Sheet, config: ImportConfig, tx: Prisma.TransactionClient = getPrisma()): Promise<Preview> {
  const deadline = Date.now() + 15_000;
  validateMapping(config.mapping, sheet);
  const events = await tx.event.findMany({ where: { companyId }, take: 5001, orderBy: [{ beginsAt: "desc" }, { id: "asc" }], select: { id: true, name: true, beginsAt: true, status: true, maxSeats: true, venue: { select: { name: true } } } });
  if (events.length > 5000) throw new ImportError("Diese Company hat mehr als 5.000 Events. Der MVP-Import unterstützt höchstens 5.000 Events pro Company.");
  const eventMap = new Map(events.map(e => [e.id,e]));
  const eventDays = new Map(events.map(e => [e.id, e.beginsAt ? localDay(e.beginsAt.toISOString()) : null]));
  if (Object.values(config.events).some(id => id && !eventMap.has(id))) throw new ImportError("Eine Event-Zuordnung ist ungültig oder gehört nicht zu dieser Company.");
  const groups = new Map<string, EventGroup>();
  const excluded = new Set(config.excluded);
  if (config.excluded.some(n => !sheet.rows.some(row => row.sourceRow === n))) throw new ImportError("Ein Zeilenausschluss verweist auf keine vorhandene Quellzeile. Bitte Datei neu einlesen.");
  const rows: PreviewRow[] = sheet.rows.map(row => {
    if (Date.now() > deadline) throw new ImportError("Die Vorschau benötigt zu viel Rechenzeit (maximal 15 Sekunden). Bitte die Datei aufteilen.");
    const { normalized, errors, warnings } = normalizeRow(row.raw, config.mapping, sheet.date1904);
    const key = groupKey(row.raw, config.mapping);
    if (!groups.has(key)) {
      if (groups.size >= 100) throw new ImportError("Maximal 100 unterschiedliche Quell-Events pro Import sind erlaubt. Bitte die Datei aufteilen.");
      const sourceDay = normalized.eventDate ? localDay(normalized.eventDate) : null;
      const candidates = events.filter(e => e.status !== "CANCELLED").map(e => {
        if (Date.now() > deadline) throw new ImportError("Die Event-Suche dauert zu lange. Bitte die Datei aufteilen.");
        const title = titleSimilarity(normalized.eventTitle, e.name);
        const sameDay = !!sourceDay && sourceDay === eventDays.get(e.id);
        const minutes = normalized.eventDate && e.beginsAt ? Math.abs(new Date(normalized.eventDate).getTime() - e.beginsAt.getTime()) / 60000 : Infinity;
        const location = normalized.location && e.venue?.name ? titleSimilarity(normalized.location, e.venue.name) : 0;
        return { id: e.id, score: Math.round(title * 50 + (sameDay ? 30 : 0) + (minutes < 1 ? 15 : minutes < 61 ? 5 : 0) + location * 5) };
      }).filter(e => e.score >= 25).sort((a,b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0,5);
      groups.set(key, { key, title: normalized.eventTitle || "Ohne Eventtitel", date: normalized.eventDate, location: normalized.location, candidates });
    }
    const event = eventMap.get(config.events[key]);
    normalized.eventId = event?.id ?? null;
    if (!event) errors.push("Bitte Event ausdrücklich zuordnen oder Zeile ausschließen.");
    if (event?.status === "CANCELLED") errors.push("Das zugeordnete Event ist storniert.");
    return { sourceRow: row.sourceRow, group: key, normalized, eventName: event?.name ?? null,
      state: excluded.has(row.sourceRow) ? "EXCLUDED" : errors.length ? "ERROR" : warnings.length ? "WARNING" : "READY", errors, warnings };
  });
  const ids = rows.flatMap(r => r.normalized.externalId ? [r.normalized.externalId] : []);
  const existing = ids.length ? await tx.booking.findMany({ where: { externalCompanyId: companyId, platform: config.platform as Platform, externalBookingId: { in: ids } }, select: { externalBookingId: true } }) : [];
  const seen = new Set(existing.map(b => b.externalBookingId));
  for (const row of rows) {
    if (row.state === "EXCLUDED") continue;
    const id = row.normalized.externalId;
    if (id && seen.has(id)) { row.state = row.errors.length ? "ERROR" : "DUPLICATE"; row.warnings.push("Externe ID ist für diese Company und Plattform bereits vorhanden oder mehrfach in der Datei. Wird übersprungen; verbleibende Fehler müssen korrigiert oder ausdrücklich ausgeschlossen werden."); }
    // Invalid rows must not prevent a later valid row with the same identity from being imported.
    else if (id && row.state !== "ERROR") seen.add(id);
  }
  const possible = rows.filter(r => !r.normalized.externalId && r.normalized.eventId && r.normalized.bookedAt && !["ERROR", "EXCLUDED"].includes(r.state));
  const heuristicWhere: Prisma.BookingWhereInput[] = possible.map(r => ({
    eventId: r.normalized.eventId!, customerEmail: r.normalized.customerEmail ? { equals: r.normalized.customerEmail, mode: "insensitive" } : null,
    bookedAt: new Date(r.normalized.bookedAt!), quantity: r.normalized.quantity,
    price: { is: { payableAmountMinor: r.normalized.gross, currency: r.normalized.currency } },
  }));
  const heuristic = possible.length ? await tx.booking.findMany({
    where: { event: { companyId }, OR: heuristicWhere },
    select: { eventId: true, customerEmail: true, bookedAt: true, quantity: true, price: { select: { payableAmountMinor: true, currency: true } } }, take: 1001,
  }) : [];
  const fingerprint = (n: PreviewRow["normalized"]) => JSON.stringify([n.eventId, n.customerEmail?.toLowerCase(), n.bookedAt, n.quantity, n.gross, n.currency]);
  const fingerprints = new Set(heuristic.map(b => JSON.stringify([b.eventId, b.customerEmail?.toLowerCase(), b.bookedAt.toISOString(), b.quantity, b.price?.payableAmountMinor, b.price?.currency])));
  for (const row of possible) {
    const key = fingerprint(row.normalized);
    if (heuristic.length > 1000) { row.warnings.push("Mehr als 1.000 mögliche bestehende Duplikate. Der heuristische Abgleich ist unvollständig; bitte bestehende Buchungen besonders sorgfältig prüfen."); row.state = "WARNING"; }
    if (fingerprints.has(key)) { row.warnings.push("Mögliches Duplikat anhand Event, E-Mail, Datum, Menge und Betrag. Wird nicht automatisch übersprungen."); row.state = "WARNING"; }
    fingerprints.add(key);
  }
  const occupied = await tx.booking.groupBy({ by: ["eventId"], where: { eventId: { in: events.map(e => e.id) }, status: { in: ["CONFIRMED", "PENDING_PAYMENT"] } }, _sum: { quantity: true } });
  if (Date.now() > deadline) throw new ImportError("Die Vorschau dauert zu lange. Bitte die Datei aufteilen und erneut versuchen.");
  const seats = new Map(occupied.map(e => [e.eventId, e._sum.quantity ?? 0]));
  const added = new Map<string,number>();
  for (const row of rows) if (["READY", "WARNING"].includes(row.state) && ["CONFIRMED", "PENDING_PAYMENT"].includes(row.normalized.status)) added.set(row.normalized.eventId!, (added.get(row.normalized.eventId!) ?? 0) + row.normalized.quantity);
  const capacity = [...added].flatMap(([id,quantity]) => {
    const event = eventMap.get(id)!;
    return (seats.get(id) ?? 0) + quantity > (event.maxSeats ?? 0) ? [`${event.name}: ${quantity} zusätzliche Plätze, ${seats.get(id) ?? 0} bereits belegt/reserviert, Kapazität ${event.maxSeats ?? 0}. Bitte Zeilen ausschließen.`] : [];
  });
  // Binds the visible preview to source cells and user choices, not mutable database state.
  // Commit always reparses the file and rechecks authoritative database state.
  const hash = createHash("sha256").update(JSON.stringify({ companyId, sheet, config })).digest("hex");
  return { hash, rows, groups: [...groups.values()], events: events.map(e => ({ id: e.id, name: e.name, beginsAt: e.beginsAt?.toISOString() ?? null, location: e.venue?.name ?? null })), capacity,
    canCommit: capacity.length === 0 && rows.every(r => r.state !== "ERROR") && rows.length > 0 };
}

export async function commitImport(slug: string, sheet: Sheet, config: ImportConfig, fileName: string, previewHash: string) {
  const { company } = await requireCompanyAccess(slug);
  const actor = (await auth())!.user!.id!;
  const startedAt = new Date();
  return withAuditContext({ actorType: "USER", actorUserId: actor, source: "booking-file-import" }, async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await getPrisma().$transaction(async tx => {
          const prior = await tx.bookingImport.findUnique({ where: { id: config.requestId }, select: { id: true, companyId: true } });
          if (prior) { if (prior.companyId !== company.id) throw new ImportError("Importkennung ist bereits vergeben. Bitte einen neuen Import starten."); return prior.id; }
          const preview = await buildPreview(company.id, sheet, config, tx);
          if (preview.hash !== previewHash) throw new ImportError("Die Einstellungen wurden verändert. Bitte Vorschau erneut prüfen.");
          if (!preview.canCommit) throw new ImportError("Der Import ist noch nicht möglich. Bitte Vorschau aktualisieren, Fehler ausschließen und Kapazität prüfen.");
          const run = await tx.bookingImport.create({ data: {
            id: config.requestId, companyId: company.id, createdById: actor, platform: config.platform as Platform,
            name: config.name || `${config.platform} · ${fileName}`.slice(0,160), fileName: fileName.slice(0,255), sheetName: sheet.name.slice(0,160),
            startedAt, completedAt: startedAt, rowCount: preview.rows.length, importedCount: 0, duplicateCount: 0, excludedCount: 0, errorCount: 0,
            mapping: config.mapping,
          } });
          let importedCount = 0, duplicateCount = 0, excludedCount = 0, errorCount = 0;
          for (const row of preview.rows) {
            const n = row.normalized;
            let bookingId: string | null = null;
            let priceSnapshot: Prisma.BookingPriceUncheckedCreateInput | null = null;
            let outcome = row.state === "DUPLICATE" ? "DUPLICATE" : row.state === "EXCLUDED" ? row.errors.length ? "ERROR" : "EXCLUDED" : "IMPORTED";
            if (outcome === "IMPORTED") {
              const id = randomUUID();
              // ON CONFLICT does not poison the transaction; no existing row is updated.
              const inserted = await tx.booking.createMany({ skipDuplicates: true, data: [{
                id, externalCompanyId: company.id, eventId: n.eventId!, platform: config.platform as Platform, origin: "PLATFORM",
                externalBookingId: n.externalId, customerName: n.customerName, customerEmail: n.customerEmail,
                quantity: n.quantity, status: n.status, bookedAt: new Date(n.bookedAt!),
              }] });
              if (!inserted.count) outcome = "DUPLICATE";
              else {
                bookingId = id;
                priceSnapshot = {
                  bookingId: id, companyId: company.id, eventId: n.eventId!, currency: n.currency,
                  unitPriceMinor: Math.floor(n.gross / n.quantity), quantity: n.quantity, originalAmountMinor: n.gross,
                  discountAmountMinor: 0, voucherAmountMinor: 0, payableAmountMinor: n.gross, calculationVersion: 2,
                  allocationSnapshot: { kind: "EXTERNAL_IMPORT", totalGrossMinor: n.gross, extraCentSeats: n.gross % n.quantity },
                  // External tax has not been verified. Do not fabricate an internal tax snapshot.
                };
                await tx.bookingPrice.create({ data: priceSnapshot });
              }
            }
            if (outcome === "IMPORTED") importedCount++;
            if (outcome === "DUPLICATE") duplicateCount++;
            if (outcome === "EXCLUDED") excludedCount++;
            if (outcome === "ERROR") errorCount++;
            await tx.bookingImportRow.create({ data: {
              importId: run.id, sourceRow: row.sourceRow, raw: sheet.rows.find(r => r.sourceRow === row.sourceRow)!.raw,
              normalized: { ...n, priceSnapshot: priceSnapshot ? {
                bookingId: priceSnapshot.bookingId, companyId: company.id, eventId: n.eventId!,
                currency: n.currency, quantity: n.quantity, unitPriceMinor: Math.floor(n.gross / n.quantity),
                originalAmountMinor: n.gross, discountAmountMinor: 0, voucherAmountMinor: 0,
                payableAmountMinor: n.gross, calculationVersion: 2,
                allocationSnapshot: { kind: "EXTERNAL_IMPORT", totalGrossMinor: n.gross, extraCentSeats: n.gross % n.quantity },
              } : null }, eventId: n.eventId, bookingId, outcome,
              messages: [...row.errors, ...row.warnings, ...(outcome === "DUPLICATE" ? ["Bereits vorhanden / übersprungen."] : [])],
            } });
          }
          await tx.bookingImport.update({ where: { id: run.id }, data: { completedAt: new Date(), importedCount, duplicateCount, excludedCount, errorCount } });
          return run.id;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60000, maxWait: 10000 });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2002"].includes(error.code) && attempt < 2) continue;
        throw error;
      }
    }
  });
}

export async function eraseImportPersonalData(slug: string, importId: string) {
  const company = await requireCompanyAdmin(slug);
  const actor = (await auth())!.user!.id!;
  await withAuditContext({ actorType: "USER", actorUserId: actor, source: "booking-import-personal-data-erasure" }, () => getPrisma().$transaction(async tx => {
    const run = await tx.bookingImport.findFirst({ where: { id: importId, companyId: company.id } });
    if (!run) throw new ImportError("Importlauf nicht gefunden.");
    await tx.bookingImportRow.updateMany({ where: { importId: run.id }, data: { raw: Prisma.DbNull, normalized: Prisma.DbNull, messages: [] } });
    await tx.bookingImport.update({ where: { id: run.id }, data: { rawDeletedAt: new Date(), name: "Import (personenbezogene Importdaten gelöscht)", fileName: "Gelöscht", sheetName: "Gelöscht", mapping: {} } });
  }));
}
