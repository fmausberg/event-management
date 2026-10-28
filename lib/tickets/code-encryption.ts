import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export class TicketCodeError extends Error {
  constructor(public readonly reason: "CONFIG" | "FORMAT" | "KEY_UNAVAILABLE" | "AUTHENTICATION") {
    super(`Ticket code unavailable (${reason})`);
  }
}

function keyring() {
  try {
    const config = JSON.parse(process.env.TICKET_CODE_ENCRYPTION_KEYS ?? "");
    if (!config || typeof config.active !== "string" || !config.keys || typeof config.keys !== "object" || Array.isArray(config.keys)) throw new Error();
    const keys = new Map<string, Buffer>();
    for (const [id, value] of Object.entries(config.keys)) {
      if (!/^[A-Za-z0-9_-]{1,32}$/.test(id) || typeof value !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error();
      const key = Buffer.from(value, "base64");
      if (key.length !== 32 || key.toString("base64") !== value) throw new Error();
      keys.set(id, key);
    }
    if (!keys.has(config.active)) throw new Error();
    return { active: config.active as string, keys };
  } catch { throw new TicketCodeError("CONFIG"); }
}

function validToken(token: string, hash: string) {
  return /^[A-Za-z0-9_-]{43}$/.test(token) && Buffer.from(token, "base64url").toString("base64url") === token &&
    /^[a-f0-9]{64}$/.test(hash) && createHash("sha256").update(token).digest("hex") === hash;
}

export function encryptTicketCode(token: string, publicTokenHash: string) {
  const { active, keys } = keyring();
  if (!validToken(token, publicTokenHash)) throw new TicketCodeError("FORMAT");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keys.get(active)!, iv);
  cipher.setAAD(Buffer.from(`ticket-code:v1:${active}:${publicTokenHash}`));
  const body = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", active, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function decryptTicketCode(encrypted: string, publicTokenHash: string) {
  const { keys } = keyring();
  if (typeof encrypted !== "string" || encrypted.length > 256 || !/^[a-f0-9]{64}$/.test(publicTokenHash)) throw new TicketCodeError("FORMAT");
  const [version, id, ivText, tagText, bodyText, extra] = encrypted.split(".");
  if (version !== "v1" || !/^[A-Za-z0-9_-]{1,32}$/.test(id ?? "") || extra !== undefined) throw new TicketCodeError("FORMAT");
  const decode = (value: string, length: number) => {
    if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) throw new TicketCodeError("FORMAT");
    const result = Buffer.from(value, "base64url");
    if (result.length !== length || result.toString("base64url") !== value) throw new TicketCodeError("FORMAT");
    return result;
  };
  const iv = decode(ivText, 12), tag = decode(tagText, 16), body = decode(bodyText, 43);
  const key = keys.get(id);
  if (!key) throw new TicketCodeError("KEY_UNAVAILABLE");
  try {
    const cipher = createDecipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(`ticket-code:v1:${id}:${publicTokenHash}`));
    cipher.setAuthTag(tag);
    const token = Buffer.concat([cipher.update(body), cipher.final()]).toString("utf8");
    if (!validToken(token, publicTokenHash)) throw new Error();
    return token;
  } catch { throw new TicketCodeError("AUTHENTICATION"); }
}
