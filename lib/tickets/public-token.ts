import "server-only";
import { createHash, randomBytes } from "node:crypto";

export function createTicketToken() {
  const token = randomBytes(32).toString("base64url");
  const publicTokenHash = createHash("sha256").update(token).digest("hex");
  return { token, publicTokenHash };
}
