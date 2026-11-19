"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyAccess, MemberAccessError } from "@/lib/companies/members";
import { parseImportFile } from "@/lib/bookings/import/parser";
import { parseConfig, buildPreview, commitImport, eraseImportPersonalData } from "@/lib/bookings/import/service";
import { suggestMapping } from "@/lib/bookings/import/normalize";
import { ImportError } from "@/lib/bookings/import/errors";
import { consumeAuthAttempt } from "@/lib/auth/rate-limit";
import type { Mapping, Preview } from "@/lib/bookings/import/types";

type Result<T> = { data: T; error?: never } | { error: string; data?: never };
function failure(error: unknown) {
  return { error: error instanceof ImportError || error instanceof MemberAccessError ? error.message : "Der Import konnte nicht verarbeitet werden. Bitte erneut versuchen oder Datei und Zuordnungen prüfen." };
}
async function read(slug: string, form: FormData) {
  const { company } = await requireCompanyAccess(slug);
  if (!await consumeAuthAttempt(company.id, "booking-import")) throw new ImportError("Zu viele Importanfragen. Bitte in spätestens 15 Minuten erneut versuchen.");
  const file = form.get("file");
  if (!(file instanceof File)) throw new ImportError("Bitte eine Datei auswählen.");
  return { company, file, parsed: await parseImportFile(file) };
}
export async function inspectFile(slug: string, form: FormData): Promise<Result<{ sheets: { name: string; headers: string[]; count: number; mapping: Mapping }[] }>> {
  try {
    const { parsed } = await read(slug, form);
    return { data: { sheets: parsed.sheets.map(s => ({ name: s.name, headers: s.headers, count: s.rows.length, mapping: suggestMapping(s.headers) })) } };
  } catch (error) { return failure(error); }
}
function settings(form: FormData) {
  const json = form.get("config");
  if (typeof json !== "string" || json.length > 512000) throw new ImportError("Importeinstellungen fehlen oder sind zu groß.");
  try { return parseConfig(JSON.parse(json)); } catch (error) { if (error instanceof ImportError) throw error; throw new ImportError("Importeinstellungen sind ungültig."); }
}
export async function previewImport(slug: string, form: FormData): Promise<Result<Preview>> {
  try {
    const { company, parsed } = await read(slug, form);
    const config = settings(form), sheet = parsed.sheets.find(s => s.name === config.sheet);
    if (!sheet) throw new ImportError("Bitte ein gültiges Tabellenblatt wählen.");
    return { data: await buildPreview(company.id, sheet, config) };
  } catch (error) { return failure(error); }
}
export async function confirmImport(slug: string, form: FormData): Promise<Result<{ id: string }>> {
  try {
    const { parsed, file } = await read(slug, form);
    const config = settings(form), sheet = parsed.sheets.find(s => s.name === config.sheet);
    const hash = form.get("previewHash");
    if (!sheet || typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash) || form.get("confirmed") !== "yes") throw new ImportError("Bitte die Vorschau prüfen und den Import ausdrücklich bestätigen.");
    const id = await commitImport(slug, sheet, config, file.name, hash);
    const companyPath = `/company/${encodeURIComponent(slug)}`;
    revalidatePath(`${companyPath}/bookings`);
    revalidatePath(`${companyPath}/bookings/imports`);
    revalidatePath(`${companyPath}/events`);
    for (const eventId of new Set(Object.values(config.events).filter(Boolean))) {
      revalidatePath(`${companyPath}/events/${encodeURIComponent(eventId)}`);
      revalidatePath(`${companyPath}/events/${encodeURIComponent(eventId)}/bookings`);
      revalidatePath(`/events/${encodeURIComponent(slug)}/${encodeURIComponent(eventId)}`);
    }
    revalidatePath("/admin/events");
    revalidatePath("/events");
    revalidatePath(`/events/${encodeURIComponent(slug)}`);
    return { data: { id } };
  } catch (error) { return failure(error); }
}
export async function deleteImportPersonalData(slug: string, id: string, form: FormData): Promise<Result<{ success: true }>> {
  try {
    if (form.get("confirmed") !== "yes" || typeof id !== "string" || !id || id.length > 191) throw new ImportError("Bitte das Löschen der Importdaten bestätigen.");
    await eraseImportPersonalData(slug, id);
    revalidatePath(`/company/${encodeURIComponent(slug)}/bookings/imports`);
    revalidatePath(`/company/${encodeURIComponent(slug)}/bookings/imports/${encodeURIComponent(id)}`);
    revalidatePath(`/company/${encodeURIComponent(slug)}/bookings`);
    return { data: { success: true } };
  } catch (error) { return failure(error); }
}
