"use server";
import { emailSchema } from "@/lib/auth/validation";
import { consumeAuthAttempt } from "@/lib/auth/rate-limit";
import { getVerificationEmail, sendVerificationEmail, verifyEmailToken } from "@/lib/auth/verification";

export async function loadVerificationEmail(token: string) {
  return getVerificationEmail(token);
}

export async function verifyEmail(_previous: { success?: boolean; message?: string }, form: FormData) {
  try {
    const token = form.get("token");
    if (typeof token === "string" && await verifyEmailToken(token)) return { success: true, message: "E-Mail bestätigt. Deine hinterlegten Rollen sind jetzt zugeordnet. Du kannst dich anmelden." };
    return { message: "Der Link ist ungültig, abgelaufen oder bereits verwendet. Bitte fordere bei Bedarf einen neuen Link an." };
  } catch { return { message: "Die Bestätigung konnte nicht abgeschlossen werden. Bitte versuche es erneut." }; }
}
export async function resendVerification(_previous: { message?: string }, form: FormData) {
  const parsed = emailSchema.safeParse(form.get("email"));
  if (!parsed.success) return { message: "Bitte gib eine gültige E-Mail-Adresse ein." };
  try {
    if (await consumeAuthAttempt(parsed.data, "verify-email")) await sendVerificationEmail(parsed.data);
  } catch { console.error("Verification email could not be sent."); }
  return { message: "Falls ein unbestätigtes Konto zu dieser Adresse existiert, erhältst du einen Bestätigungslink. Bitte prüfe auch den Spam-Ordner. Bei mehreren Versuchen warte bitte 15 Minuten." };
}
