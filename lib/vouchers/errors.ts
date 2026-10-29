import "server-only";

const messages = {
  INVALID_INPUT: "Bitte prüfe die Angaben zur Buchung.",
  INVALID_CODE: "Dieser Gutschein ist nicht verfügbar oder hier nicht gültig.",
  LIMIT_REACHED: "Das Nutzungslimit dieses Gutscheins ist erreicht.",
  NO_BALANCE: "Für diesen Gutschein ist derzeit kein Guthaben verfügbar.",
  NO_BENEFIT: "Dieser Gutschein reduziert den Buchungsbetrag nicht.",
  MINIMUM_AMOUNT: "Nach dem Gutschein müssen mindestens 0,50 EUR oder genau 0 EUR verbleiben.",
  PRICE_CHANGED: "Der Preis wurde geändert. Bitte prüfe den aktuellen Preis.",
  BOOKING_CONFLICT: "Dieser Buchungsversuch wurde bereits mit anderen Angaben verwendet oder abgeschlossen.",
  RELEASE_UNSAFE: "Die Zahlung ist noch nicht sicher beendet; die Reservierung bleibt bestehen.",
  FORBIDDEN: "Du darfst diese Gutscheinkampagne nicht verwalten.",
  UNAVAILABLE: "Die Gutscheinprüfung ist derzeit nicht verfügbar. Bitte versuche es erneut.",
} as const;

export type VoucherErrorCode = keyof typeof messages;
export class VoucherError extends Error {
  constructor(public readonly code: VoucherErrorCode) { super(messages[code]); }
}
export type VoucherResult<T> = { ok: true; value: T } | { ok: false; error: { code: VoucherErrorCode; message: string } };
// Never forward input, Prisma metadata, exception causes, digests or key material.
export function voucherFailure(error: unknown): VoucherResult<never> {
  const code = error instanceof VoucherError ? error.code : "UNAVAILABLE";
  return { ok: false, error: { code, message: messages[code] } };
}

