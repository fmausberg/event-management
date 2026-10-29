"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { VoucherError } from "@/lib/vouchers/errors";
import { campaignInput, issueInput, type VoucherAdminState } from "@/lib/vouchers/admin-validation";
import { saveVoucherCampaign, changeVoucherCampaignStatus, changeVoucherCodeStatus, issueVoucherCodes, VoucherAdminError } from "@/lib/vouchers/admin-service";

function failure(error: unknown): VoucherAdminState {
  if (error instanceof VoucherAdminError) return { message: error.message };
  if (error instanceof z.ZodError) return { message: "Bitte Name, Wert, Limits, Ziele und Zeitangaben prüfen." };
  if (error instanceof VoucherError && error.code === "FORBIDDEN") return { message: "Keine Berechtigung für diese Gutscheinverwaltung." };
  return { message: "Der Vorgang konnte nicht abgeschlossen werden. Bitte den gespeicherten Stand prüfen und denselben Versuch wiederholen." };
}
function refresh(slug: string) { revalidatePath(`/company/${encodeURIComponent(slug)}/vouchers`); revalidatePath("/company/[companyKey]/vouchers/[campaignId]", "page"); }
export async function saveCampaign(slug: string, id: string | null, _state: VoucherAdminState, form: FormData): Promise<VoucherAdminState> {
  try {
    const raw = Object.fromEntries(Object.keys(campaignInput.shape).map(key => [key, key.endsWith("Ids") ? form.getAll(key) : form.get(key) ?? ""]));
    const campaignId = await saveVoucherCampaign(slug, id, raw); refresh(slug);
    return { success: true, campaignId, message: "Kampagne gespeichert." };
  } catch (error) { return failure(error); }
}
export async function setCampaignStatus(slug: string, id: string, _state: VoucherAdminState, form: FormData): Promise<VoucherAdminState> {
  try { await changeVoucherCampaignStatus(slug, id, form.get("status")); refresh(slug); return { success: true, message: "Status gespeichert." }; }
  catch (error) { return failure(error); }
}
export async function createCodes(slug: string, id: string, _state: VoucherAdminState, form: FormData): Promise<VoucherAdminState> {
  try {
    const raw = Object.fromEntries(Object.keys(issueInput.shape).map(key => [key, form.get(key) ?? ""]));
    const result = await issueVoucherCodes(slug, id, raw); refresh(slug);
    return { success: true, ...result, message: result.replay ? "Diese Ausgabe wurde bereits gespeichert. Klartextcodes können nicht erneut angezeigt werden." : "Ausgabe gespeichert. Die Codes jetzt sicher übernehmen; sie werden später nicht erneut angezeigt." };
  } catch (error) { return failure(error); }
}
export async function setCodeStatus(slug: string, id: string, codeId: string, _state: VoucherAdminState, form: FormData): Promise<VoucherAdminState> {
  try { await changeVoucherCodeStatus(slug, id, codeId, form.get("status")); refresh(slug); return { success: true, message: "Codestatus gespeichert." }; }
  catch (error) { return failure(error); }
}
