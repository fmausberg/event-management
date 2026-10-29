import "server-only";
import { VoucherError } from "./errors";

export class VoucherConfigurationError extends VoucherError {
  constructor() {
    super("UNAVAILABLE");
    this.name = "VoucherConfigurationError";
    this.message += " VOUCHER_CODE_DIGEST_KEYS fehlt oder ist ungültig: Erwartet wird ein JSON-Schlüsselring mit 1–10 positiven numerischen Versionen, einem vorhandenen aktiven Schlüssel und je 32 zufälligen Bytes in kanonischem Base64.";
  }
}

/** Lazy server-only validation, matching the existing ticket-keyring pattern.
 * Never attach the original input or parsing exception to the error.
 */
export function getVoucherDigestKeyring() {
  try {
    const config: unknown = JSON.parse(process.env.VOUCHER_CODE_DIGEST_KEYS ?? "");
    if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error();
    const { active, keys: configuredKeys } = config as Record<string, unknown>;
    if (typeof active !== "number" || !Number.isSafeInteger(active) || active < 1 || active > 2147483647 ||
      !configuredKeys || typeof configuredKeys !== "object" || Array.isArray(configuredKeys)) throw new Error();
    const entries = Object.entries(configuredKeys);
    if (!entries.length || entries.length > 10) throw new Error();
    const keys = entries.map(([version, encoded]) => {
      if (!/^[1-9][0-9]*$/.test(version) || Number(version) > 2147483647 ||
        typeof encoded !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new Error();
      const key = Buffer.from(encoded, "base64");
      if (key.length !== 32 || key.toString("base64") !== encoded) throw new Error();
      return { version: Number(version), key };
    });
    if (!keys.some(k => k.version === active)) throw new Error();
    return { active, keys };
  } catch { throw new VoucherConfigurationError(); }
}
