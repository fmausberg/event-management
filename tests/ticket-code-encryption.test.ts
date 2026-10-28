import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTicketToken } from "@/lib/tickets/public-token";
import { decryptTicketCode, encryptTicketCode } from "@/lib/tickets/code-encryption";
vi.mock("server-only", () => ({}));
const oldKey = Buffer.alloc(32, 7).toString("base64"), newKey = Buffer.alloc(32, 9).toString("base64");
function keys(active = "old", values = { old: oldKey }) { vi.stubEnv("TICKET_CODE_ENCRYPTION_KEYS", JSON.stringify({ active, keys: values })); }
beforeEach(() => keys());
afterEach(() => vi.unstubAllEnvs());

it("encrypts with random IVs and authenticates the stored hash", () => {
  const record = createTicketToken();
  expect(decryptTicketCode(record.encryptedPublicToken, record.publicTokenHash)).toBe(record.token);
  expect(record.encryptedPublicToken).not.toContain(record.token);
  expect(encryptTicketCode(record.token, record.publicTokenHash)).not.toBe(record.encryptedPublicToken);
  expect(() => decryptTicketCode(record.encryptedPublicToken, "0".repeat(64))).toThrow("AUTHENTICATION");
});
it.each(["", "{}", "null", "not-json", '{"active":"k1","keys":{"k1":"short"}}', JSON.stringify({ active: "missing", keys: { old: oldKey } }), JSON.stringify({ active: "old", keys: { old: Buffer.alloc(31).toString("base64") } })])("fails closed for invalid configuration %s", (value) => {
  vi.stubEnv("TICKET_CODE_ENCRYPTION_KEYS", value);
  expect(() => createTicketToken()).toThrow("CONFIG");
});
it("rejects wrong keys and unknown key IDs without exposing secrets", () => {
  const record = createTicketToken();
  keys("old", { old: newKey });
  expect(() => decryptTicketCode(record.encryptedPublicToken, record.publicTokenHash)).toThrow("AUTHENTICATION");
  vi.stubEnv("TICKET_CODE_ENCRYPTION_KEYS", JSON.stringify({ active: "new", keys: { new: newKey } }));
  expect(() => decryptTicketCode(record.encryptedPublicToken, record.publicTokenHash)).toThrow("KEY_UNAVAILABLE");
});
it("rejects malformed, unsupported and tampered ciphertexts", () => {
  const record = createTicketToken();
  for (const encrypted of ["", "v2.k1.a.b.c", record.encryptedPublicToken + ".extra", record.encryptedPublicToken.replace("v1.", "v9."), "x".repeat(257)]) {
    expect(() => decryptTicketCode(encrypted, record.publicTokenHash)).toThrow("FORMAT");
  }
  for (const index of [2, 3, 4]) {
    const parts = record.encryptedPublicToken.split(".");
    const bytes = Buffer.from(parts[index], "base64url"); bytes[0] ^= 1;
    parts[index] = bytes.toString("base64url");
    expect(() => decryptTicketCode(parts.join("."), record.publicTokenHash)).toThrow("AUTHENTICATION");
  }
});
it("rotates encryption keys without changing the code or hash", () => {
  const record = createTicketToken();
  vi.stubEnv("TICKET_CODE_ENCRYPTION_KEYS", JSON.stringify({ active: "new", keys: { old: oldKey, new: newKey } }));
  const token = decryptTicketCode(record.encryptedPublicToken, record.publicTokenHash);
  const rotated = encryptTicketCode(token, record.publicTokenHash);
  expect(rotated).toMatch(/^v1\.new\./);
  vi.stubEnv("TICKET_CODE_ENCRYPTION_KEYS", JSON.stringify({ active: "new", keys: { new: newKey } }));
  expect(decryptTicketCode(rotated, record.publicTokenHash)).toBe(record.token);
});
