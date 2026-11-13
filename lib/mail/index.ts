import "server-only";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { archiveSentMail } from "./sent-archive";
import { sendMicrosoftGraphMail, verifyMicrosoftGraphConnection } from "./microsoft-graph";
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
  replyTo: z.email().optional(),
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

function getMailer(timeoutMs?: number) {
  // Lazy configuration: building and running unrelated pages needs no SMTP secret.
  const result = configSchema.safeParse({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT ?? "465",
    secure: process.env.SMTP_SECURE ?? "true",
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    from: process.env.MAIL_FROM_ADDRESS ?? process.env.SMTP_USER,
    name: process.env.MAIL_FROM_NAME ?? "Event-Management",
    replyTo: process.env.MAIL_REPLY_TO?.trim() || undefined,
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
    connectionTimeout: timeoutMs ?? 15_000,
    greetingTimeout: timeoutMs ?? 15_000,
    socketTimeout: timeoutMs ?? 30_000,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return { transport, from: { name: config.name, address: config.from }, replyTo: config.replyTo, testRecipient: config.testRecipient };
}

const transportSchema = z.enum(["smtp", "microsoft-graph"]);
const graphConfigSchema = z.object({
  tenantId: header,
  clientId: header,
  clientSecret: z.string().min(1),
  from: z.email(),
  name: header,
  replyTo: z.email().optional(),
  testRecipient: z.email().optional(),
});

function getTransportMode() {
  const result = transportSchema.safeParse(process.env.MAIL_TRANSPORT?.trim() || "smtp");
  if (!result.success) throw new Error("MAIL_TRANSPORT muss smtp oder microsoft-graph sein.");
  return result.data;
}

function getGraphConfig() {
  const result = graphConfigSchema.safeParse({
    tenantId: process.env.MS_GRAPH_TENANT_ID,
    clientId: process.env.MS_GRAPH_CLIENT_ID,
    clientSecret: process.env.MS_GRAPH_CLIENT_SECRET,
    from: process.env.MAIL_FROM_ADDRESS,
    name: process.env.MAIL_FROM_NAME ?? "Event-Management",
    replyTo: process.env.MAIL_REPLY_TO?.trim() || undefined,
    testRecipient: process.env.MAIL_TEST_RECIPIENT?.trim() || undefined,
  });
  if (!result.success) throw new Error("Microsoft-Graph-Mailversand ist nicht korrekt konfiguriert.");
  return {
    credentials: {
      tenantId: result.data.tenantId,
      clientId: result.data.clientId,
      clientSecret: result.data.clientSecret,
    },
    from: { name: result.data.name, address: result.data.from },
    replyTo: result.data.replyTo,
    testRecipient: result.data.testRecipient,
  };
}

/** Server-internal only; callers must authorize recipients and supply trusted HTML. */
export async function sendMail(input: MailMessage): Promise<{ messageId: string }> {
  const parsed = messageSchema.safeParse(input);
  if (!parsed.success) throw new Error("Ungültiger Empfänger, Betreff oder E-Mail-Inhalt.");

  const mode = getTransportMode();
  const config = mode === "smtp" ? getMailer() : getGraphConfig();
  try {
    const footer = mailFooter(parsed.data.to, "https://event-yoga.com/impressum/");
    const content = parsed.data.html ?? `<div style="max-width:600px;margin:auto;font-family:Arial,sans-serif;line-height:1.6">${escapeHtml(parsed.data.text).replace(/\n/g, "<br>")}</div>`;
    const html = /<\/body\s*>/i.test(content)
      ? content.replace(/<\/body\s*>/i, () => `${footer.html}</body>`)
      : `${content}\n${footer.html}`;
    const message = {
      ...parsed.data,
      ...(config.replyTo ? { replyTo: config.replyTo } : {}),
      text: `${parsed.data.text}\n\n${footer.text}`,
      html,
      from: config.from,
      to: config.testRecipient ?? parsed.data.to,
    };
    const compiled = new MailComposer({ ...message, disableFileAccess: true, disableUrlAccess: true }).compile();
    const raw = await compiled.build();
    const mimeMessageId = compiled.messageId();
    let messageId = mimeMessageId;

    if ("transport" in config) {
      const info = await config.transport.sendMail({
        ...message,
        raw,
        envelope: compiled.getEnvelope(),
        messageId: mimeMessageId,
      });
      if (info.rejected.length || !info.accepted.length) throw new Error("Recipient rejected");
      messageId = info.messageId || mimeMessageId;
      try {
        await archiveSentMail(raw);
      } catch {
        // Delivery succeeded. Do not throw, retry SMTP, or log the underlying error.
        console.error("[mail:archive] SMTP delivery succeeded; saving the Sent copy failed. Check IMAP configuration, folder and quota.");
      }
    } else {
      await sendMicrosoftGraphMail({
        credentials: config.credentials,
        sender: config.from.address,
        raw,
      });
      // Graph's sendMail API returns 202 Accepted without a provider message ID.
      // Return the MIME Message-ID for consistent internal logging.
    }

    return { messageId };
  } catch {
    // Do not expose provider responses, credentials, recipients or message contents.
    throw new Error("Die E-Mail konnte nicht versendet werden. Bitte später erneut versuchen.");
  }
}

/** Checks the configured transport without sending an email. */
export async function verifyMailConnection(timeoutMs?: number): Promise<void> {
  const mode = getTransportMode();
  if (mode === "microsoft-graph") {
    const { credentials } = getGraphConfig();
    try {
      await verifyMicrosoftGraphConnection(credentials, timeoutMs);
    } catch (error) {
      const statusCode = error && typeof error === "object" && "statusCode" in error ? error.statusCode : undefined;
      throw Object.assign(new Error("Microsoft-Graph-Verbindung fehlgeschlagen. Zugangsdaten prüfen."), {
        statusCode: typeof statusCode === "number" ? statusCode : undefined,
      });
    }
    return;
  }

  const { transport } = getMailer(timeoutMs);
  try {
    await transport.verify();
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    throw Object.assign(new Error("SMTP-Verbindung fehlgeschlagen. Bitte Zugangsdaten und Servereinstellungen prüfen."), {
      code: code === "EAUTH" || code === "ETIMEDOUT" ? code : undefined,
    });
  } finally {
    transport.close?.();
  }
}
