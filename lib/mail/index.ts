import "server-only";
import nodemailer from "nodemailer";
import { z } from "zod";

const header = z.string().trim().min(1).refine((value) => !/[\r\n]/.test(value));
const configSchema = z.object({
  host: header,
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.enum(["true", "false"]).transform((value) => value === "true"),
  user: z.email(),
  password: z.string().min(1),
  from: z.email(),
  name: header,
  testRecipient: z.email().optional(),
});
const messageSchema = z.object({
  to: z.email(),
  subject: header.max(998),
  text: z.string().trim().min(1),
  html: z.string().min(1).optional(),
});
export type MailMessage = z.input<typeof messageSchema>;

function getMailer() {
  // Lazy configuration: building and running unrelated pages needs no SMTP secret.
  const result = configSchema.safeParse({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT ?? "465",
    secure: process.env.SMTP_SECURE ?? "true",
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    from: process.env.MAIL_FROM_ADDRESS ?? process.env.SMTP_USER,
    name: process.env.MAIL_FROM_NAME ?? "Event-Management",
    testRecipient: process.env.MAIL_TEST_RECIPIENT?.trim() || undefined,
  });
  if (!result.success) throw new Error("Mailversand ist nicht korrekt konfiguriert. Bitte SMTP-Umgebungsvariablen prüfen.");
  const config = result.data;
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: true,
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    auth: { user: config.user, pass: config.password },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return { transport, from: { name: config.name, address: config.from }, testRecipient: config.testRecipient };
}

/** Server-internal only; callers must authorize recipients and supply trusted HTML. */
export async function sendMail(input: MailMessage): Promise<{ messageId: string }> {
  const parsed = messageSchema.safeParse(input);
  if (!parsed.success) throw new Error("Ungültiger Empfänger, Betreff oder E-Mail-Inhalt.");
  const { transport, from, testRecipient } = getMailer();
  try {
    const info = await transport.sendMail({ ...parsed.data, from, to: testRecipient ?? parsed.data.to });
    if (info.rejected.length || !info.accepted.length) throw new Error("Recipient rejected");
    return { messageId: info.messageId };
  } catch {
    // Do not expose SMTP responses, credentials, recipients or message contents.
    throw new Error("Die E-Mail konnte nicht versendet werden. Bitte später erneut versuchen.");
  }
}

/** Checks connection/authentication without sending an email. */
export async function verifyMailConnection(): Promise<void> {
  const { transport } = getMailer();
  try {
    await transport.verify();
  } catch {
    throw new Error("SMTP-Verbindung fehlgeschlagen. Bitte Zugangsdaten und Servereinstellungen prüfen.");
  }
}
