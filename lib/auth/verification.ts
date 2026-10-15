import { emailVerification } from "@/lib/mail/templates/email-verification";
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/db/prisma";
import { findUserByEmail } from "./users";
import { claimVerifiedAssignments } from "@/lib/companies/claim-memberships";
import { sendMail } from "@/lib/mail";

export function accountOrigin() {
  const url = new URL(process.env.AUTH_URL ?? "http://localhost:3000");
  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:" && url.hostname === "localhost")) throw new Error("AUTH_URL must use HTTPS");
  return url.origin;
}
const digest = (token: string) => createHash("sha256").update(token).digest("hex");

export async function getVerificationEmail(token: string): Promise<string | null> {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const db = getPrisma();
  const entry = await db.verificationToken.findUnique({ where: { token: digest(token) } });
  if (!entry || entry.expires <= new Date()) return null;
  let binding;
  try { binding = JSON.parse(entry.identifier); } catch { return null; }
  if (!binding || binding.purpose !== "verify-email" || typeof binding.userId !== "string" || typeof binding.email !== "string") return null;
  const users = await db.user.findMany({ where: { email: { equals: binding.email, mode: "insensitive" } }, select: { id: true, email: true }, take: 2 });
  return users.length === 1 && users[0].id === binding.userId ? users[0].email : null;
}

export async function sendVerificationEmail(email: string) {
  const user = await findUserByEmail(email);
  if (!user || user.emailVerified) return;
  const token = randomBytes(32).toString("base64url");
  const identifier = JSON.stringify({ purpose: "verify-email", userId: user.id, email: user.email.trim().toLowerCase() });
  await getPrisma().verificationToken.create({ data: { identifier, token: digest(token), expires: new Date(Date.now() + 24 * 60 * 60 * 1000) } });
  // A fragment avoids tokens in access logs and Referer headers. GET never verifies.
  const link = `${accountOrigin()}/verify-email#${token}`;
  await sendMail({ to: user.email, ...emailVerification(link) });
}

export async function verifyEmailToken(token: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await getPrisma().$transaction(async (tx) => {
        const entry = await tx.verificationToken.findUnique({ where: { token: digest(token) } });
        if (!entry || entry.expires <= new Date()) return false;
        let binding;
        try { binding = JSON.parse(entry.identifier); } catch { return false; }
        if (binding.purpose !== "verify-email" || typeof binding.userId !== "string" || typeof binding.email !== "string") return false;
        const users = await tx.user.findMany({ where: { email: { equals: binding.email, mode: "insensitive" } }, select: { id: true }, take: 2 });
        if (users.length !== 1 || users[0].id !== binding.userId) return false;
        const consumed = await tx.verificationToken.deleteMany({ where: { token: digest(token), expires: { gt: new Date() } } });
        if (consumed.count !== 1) return false;
        await tx.user.update({ where: { id: binding.userId }, data: { emailVerified: new Date() } });
        await claimVerifiedAssignments(tx, binding.userId);
        await tx.verificationToken.deleteMany({ where: { identifier: entry.identifier } });
        return true;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !["P2002", "P2034"].includes(error.code) || attempt === 2) throw error;
    }
  }
  return false;
}
