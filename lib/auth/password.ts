import "server-only";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { compare } from "bcryptjs";

// Versioned format fixes the work parameters for future verification.
// OWASP scrypt configuration: N=2^15, r=8, p=3 (32 MiB).
const prefix = "scrypt-v1";
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt);
  return `${prefix}$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, passwordHash: string | null) {
  if (passwordHash && /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(passwordHash)) {
    // Existing accounts retain bcrypt verification. Their original validation
    // allowed at most 72 bytes; never accept a longer input via silent truncation.
    const valid = await compare(password, passwordHash);
    return Buffer.byteLength(password, "utf8") <= 72 && valid;
  }
  const match = passwordHash?.match(/^scrypt-v1\$([a-f0-9]{32})\$([a-f0-9]{128})$/);
  // Missing users and unknown hash formats still perform the expensive derivation.
  const salt = match ? Buffer.from(match[1], "hex") : Buffer.alloc(16);
  const expected = match ? Buffer.from(match[2], "hex") : Buffer.alloc(64);
  const actual = await deriveKey(password, salt);
  return timingSafeEqual(actual, expected) && !!match;
}
