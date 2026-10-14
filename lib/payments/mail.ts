import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getPrisma } from "@/lib/db/prisma";
import { sendMail, type MailMessage } from "@/lib/mail";

function key() {
  if (!process.env.AUTH_SECRET) throw new Error("AUTH_SECRET is required");
  return createHash("sha256").update(`payment-mail:${process.env.AUTH_SECRET}`).digest();
}
export function encryptPaymentMail(message: MailMessage) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(message), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}
export function decryptPaymentMail(value: string): MailMessage {
  const [iv, tag, body] = value.split(".").map((part) => Buffer.from(part, "base64url"));
  const cipher = createDecipheriv("aes-256-gcm", key(), iv);
  cipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([cipher.update(body), cipher.final()]).toString("utf8"));
}
export async function deliverPaymentMail(paymentId: string) {
  const db = getPrisma();
  const lockedUntil = new Date(Date.now() + 5 * 60_000);
  const lock = await db.paymentMail.updateMany({ where: { paymentId, sentAt: null, OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }] }, data: { lockedUntil } });
  if (!lock.count) return;
  try {
    const mail = await db.paymentMail.findUniqueOrThrow({ where: { paymentId } });
    if (!mail.encryptedMessage) throw new Error("Missing mail payload");
    await sendMail(decryptPaymentMail(mail.encryptedMessage));
    await db.paymentMail.update({ where: { paymentId }, data: { sentAt: new Date(), encryptedMessage: null, lockedUntil: null } });
  } catch (error) {
    await db.paymentMail.updateMany({ where: { paymentId, lockedUntil }, data: { lockedUntil: null } });
    throw error;
  }
}
