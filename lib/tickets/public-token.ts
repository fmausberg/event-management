import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { encryptTicketCode } from "./code-encryption";

export function createTicketToken() {
  const token = randomBytes(32).toString("base64url");
  const publicTokenHash = createHash("sha256").update(token).digest("hex");
  return { token, publicTokenHash, encryptedPublicToken: encryptTicketCode(token, publicTokenHash) };
}
