import "server-only";
import { ImapFlow } from "imapflow";
import { z } from "zod";

const configSchema = z.object({
  host: z.string().trim().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  user: z.email(),
  password: z.string().min(1),
});

/** Archive only: callers must never retry SMTP when this operation fails. */
export async function archiveSentMail(raw: Buffer): Promise<void> {
  if (process.env.IMAP_ARCHIVE_ENABLED === "false") return;
  const host = process.env.IMAP_HOST?.trim() || "imap.strato.de";
  const reuseSmtp = host === "imap.strato.de" && process.env.SMTP_HOST === "smtp.strato.de"
    && !process.env.IMAP_USER?.trim() && !process.env.IMAP_PASSWORD;
  const config = configSchema.parse({
    host, port: process.env.IMAP_PORT || "993",
    user: reuseSmtp ? process.env.SMTP_USER : process.env.IMAP_USER,
    password: reuseSmtp ? process.env.SMTP_PASSWORD : process.env.IMAP_PASSWORD,
  });
  const client = new ImapFlow({
    host: config.host, port: config.port, secure: true,
    auth: { user: config.user, pass: config.password },
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    logger: false, logRaw: false,
    connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
  });
  // Never let an asynchronous socket error expose server responses or credentials.
  client.on("error", () => {});
  try {
    await client.connect();
    const mailboxes = (await client.list()).filter((box) => !box.flags.has("\\Noselect"));
    const sent = mailboxes.filter((box) => box.specialUse === "\\Sent");
    const serverSent = sent.filter((box) => box.specialUseSource === "extension");
    const configuredPath = process.env.IMAP_SENT_FOLDER?.trim();
    const candidates = configuredPath
      ? mailboxes.filter((box) => box.path === configuredPath)
      : serverSent.length ? serverSent : sent.length ? sent : mailboxes.filter((box) => /^(sent|gesendet|sent items|sent messages)$/i.test(box.name));
    if (candidates.length !== 1) throw new Error("Sent mailbox missing or ambiguous");
    const result = await client.append(candidates[0].path, raw, ["\\Seen"]);
    if (!result) throw new Error("Archive append failed");
  } finally {
    try { if (client.usable) await client.logout(); }
    finally { client.close(); }
  }
}
