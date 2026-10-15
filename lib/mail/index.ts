import "server-only";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { archiveSentMail } from "./sent-archive";
import { z } from "zod";
import { escapeHtml, mailFooter } from "./templates/footer";

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
  attachments: z.array(z.object({
    filename: header,
    content: z.union([z.string(), z.instanceof(Buffer)]),
    contentType: header.optional(),
    encoding: z.enum(["utf8", "base64", "hex"]).optional(),
    cid: header.optional(),
  })).optional(),
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
    const imprintUrl = new URL("/impressum", process.env.AUTH_URL ?? "http://localhost:3000");
    if (!["http:", "https:"].includes(imprintUrl.protocol)) throw new Error("Invalid mail origin");
    const footer = mailFooter(parsed.data.to, imprintUrl.href);
    const content = parsed.data.html ?? `<div style="max-width:600px;margin:auto;font-family:Arial,sans-serif;line-height:1.6">${escapeHtml(parsed.data.text).replace(/\n/g, "<br>")}</div>`;
    const html = /<\/body\s*>/i.test(content)
      ? content.replace(/<\/body\s*>/i, () => `${footer.html}</body>`)
      : `${content}\n${footer.html}`;
    const message = { ...parsed.data, text: `${parsed.data.text}\n\n${footer.text}`, html, from, to: testRecipient ?? parsed.data.to };
    const compiled = new MailComposer({ ...message, disableFileAccess: true, disableUrlAccess: true }).compile();
    const raw = await compiled.build();
    const info = await transport.sendMail({ ...message, raw, envelope: compiled.getEnvelope(), messageId: compiled.messageId() });
    if (info.rejected.length || !info.accepted.length) throw new Error("Recipient rejected");
    try {
      await archiveSentMail(raw);
    } catch {
      // Delivery succeeded. Do not throw, retry SMTP, or log the underlying error.
      console.error("[mail:archive] SMTP delivery succeeded; saving the Sent copy failed. Check IMAP configuration, folder and quota.");
    }
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
