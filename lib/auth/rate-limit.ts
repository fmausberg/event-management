import "server-only";
import { createHash } from "node:crypto";
import { getPrisma } from "@/lib/db/prisma";

export async function consumeAuthAttempt(email: string, kind: "login" | "register") {
  const prisma = getPrisma();
  const now = new Date();
  const windowMs = 15 * 60 * 1000;
  const window = Math.floor(now.getTime() / windowMs);
  const digest = createHash("sha256").update(email).digest("hex");
  const key = `${kind}:${window}:${digest}`;
  await prisma.authRateLimit.deleteMany({ where: { expiresAt: { lte: now } } });
  // Prisma's native PostgreSQL upsert increments atomically across instances.
  const entry = await prisma.authRateLimit.upsert({
    where: { key },
    create: { key, attempts: 1, expiresAt: new Date((window + 1) * windowMs) },
    update: { attempts: { increment: 1 } },
  });
  return entry.attempts <= (kind === "login" ? 10 : 5);
}
