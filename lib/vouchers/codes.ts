import "server-only";
import { createHmac } from "node:crypto";
import { VoucherError } from "./errors";
import { getVoucherDigestKeyring } from "./config";

export function normalizeVoucherCode(input: unknown): string {
  if (typeof input !== "string" || input.length > 160) throw new VoucherError("INVALID_CODE");
  const code = input.trim();
  // ASCII only: avoid Unicode case-folding collisions. Preserve hyphens/underscores.
  if (!/^[A-Za-z0-9_-]{4,128}$/.test(code)) throw new VoucherError("INVALID_CODE");
  return code.toUpperCase();
}

/** Lookup all retained versions; ambiguous duplicate codes are rejected by the caller. */
export function voucherCodeDigests(input: unknown) {
  const code = normalizeVoucherCode(input);
  const { keys } = getVoucherDigestKeyring();
  return keys.map(({ version, key }) => ({
    digestVersion: version,
    codeDigest: createHmac("sha256", key).update(`voucher-code:v1:${version}:${code}`).digest("hex"),
  }));
}

/** For future issuance only; does not create a code or make rotation uniqueness safe. */
export function voucherCodeDigest(input: unknown) {
  const { active } = getVoucherDigestKeyring();
  return voucherCodeDigests(input).find(d => d.digestVersion === active)!;
}

