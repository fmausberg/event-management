import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

function signature(value: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required");
  return createHmac("sha256", secret).update(`account-ticket:${value}`).digest("base64url");
}

// A separate, short-lived credential preserves all existing emailed ticket tokens.
// Call only after verifying ownership. Redemption still checks live ticket state.
export function createAccountTicketToken(id: string, now = Date.now()) {
  const expires = now + 24 * 60 * 60 * 1000;
  const value = Buffer.from(JSON.stringify({ id, expires })).toString("base64url");
  return { token: `account.${value}.${signature(value)}`, expires };
}

export function readAccountTicketToken(token: unknown, now = Date.now()): string | null {
  if (typeof token !== "string" || token.length > 512) return null;
  try {
    const [prefix, value, sig, extra] = token.split(".");
    if (prefix !== "account" || !value || !sig || extra !== undefined) return null;
    const expected = Buffer.from(signature(value));
    const actual = Buffer.from(sig);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const payload = JSON.parse(Buffer.from(value, "base64url").toString());
    if (typeof payload.id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(payload.id) || !Number.isSafeInteger(payload.expires) || payload.expires <= now) return null;
    return payload.id;
  } catch { return null; }
}
