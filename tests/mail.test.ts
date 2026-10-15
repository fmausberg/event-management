import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sendMail, verifyMailConnection } from "@/lib/mail";
import { archiveSentMail } from "@/lib/mail/sent-archive";
vi.mock("@/lib/mail/sent-archive", () => ({ archiveSentMail: vi.fn() }));

const { createTransport, send, verify } = vi.hoisted(() => ({ createTransport: vi.fn(), send: vi.fn(), verify: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("nodemailer", () => ({ default: { createTransport } }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("MAIL_TEST_RECIPIENT", undefined);
  for (const [name, value] of Object.entries({ SMTP_HOST: "smtp.strato.de", SMTP_PORT: "465", SMTP_SECURE: "true", SMTP_USER: "ticket@mausberg.net", SMTP_PASSWORD: "test-secret", MAIL_FROM_ADDRESS: "ticket@mausberg.net", MAIL_FROM_NAME: "Event-Management" })) vi.stubEnv(name, value);
  createTransport.mockReturnValue({ sendMail: send, verify });
  send.mockResolvedValue({ messageId: "test-id", accepted: ["recipient@example.com"], rejected: [] });
});
afterEach(() => vi.unstubAllEnvs());
const message = { to: "recipient@example.com", subject: "Buchung", text: "Danke!" };

it("redirects every message exclusively to the configured test recipient", async () => {
  vi.stubEnv("MAIL_TEST_RECIPIENT", " test@example.com ");
  await sendMail(message);
  await sendMail({ ...message, to: "another@example.com" });
  expect(send).toHaveBeenCalledTimes(2);
  for (const [index, [sent]] of send.mock.calls.entries()) {
    expect(sent.to).toBe("test@example.com");
    const intended = index === 0 ? message.to : "another@example.com";
    expect(sent.text).toContain(intended);
    expect(sent.html).toContain(intended);
    expect(sent.html).not.toContain("test@example.com");
  }
});
it.each([undefined, "", "   "])("uses the real recipient when the override is %j", async (value) => {
  vi.stubEnv("MAIL_TEST_RECIPIENT", value);
  await sendMail(message);
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: message.to }));
});
it("blocks sending rather than using real recipients for an invalid override", async () => {
  vi.stubEnv("MAIL_TEST_RECIPIENT", "invalid-address");
  await expect(sendMail(message)).rejects.toThrow("nicht korrekt konfiguriert");
  expect(createTransport).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

it("sends text and optional HTML with a trusted sender over validated TLS", async () => {
  expect(await sendMail({ ...message, html: "<p>Danke!</p>" })).toEqual({ messageId: "test-id" });
  expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: "smtp.strato.de", port: 465, secure: true, requireTLS: true, tls: { minVersion: "TLSv1.2", rejectUnauthorized: true }, auth: { user: "ticket@mausberg.net", pass: "test-secret" }, logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true }));
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: message.to, html: expect.stringContaining("<p>Danke!</p>"), text: expect.stringContaining(message.text), from: { name: "Event-Management", address: "ticket@mausberg.net" } }));
});
it("requires STARTTLS when implicit TLS is disabled", async () => {
  vi.stubEnv("SMTP_SECURE", "false"); vi.stubEnv("SMTP_PORT", "587");
  await sendMail(message);
  expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ secure: false, requireTLS: true, port: 587 }));
});
it.each(["SMTP_PASSWORD", "SMTP_USER", "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE"])("fails safely with invalid %s", async (name) => {
  vi.stubEnv(name, "");
  await expect(sendMail(message)).rejects.toThrow("nicht korrekt konfiguriert");
  expect(createTransport).not.toHaveBeenCalled();
});
it.each([{ to: "bad" }, { subject: "Subject\r\nBcc: other@example.com" }, { text: " " }])("rejects invalid messages before connecting", async (invalid) => {
  await expect(sendMail({ ...message, ...invalid })).rejects.toThrow("Ungültiger");
  expect(createTransport).not.toHaveBeenCalled();
});
it("does not expose SMTP errors or retry ambiguous delivery failures", async () => {
  send.mockRejectedValue(new Error("test-secret recipient@example.com"));
  await expect(sendMail(message)).rejects.toThrow(/^Die E-Mail konnte nicht versendet werden/);
  expect(send).toHaveBeenCalledTimes(1);
});
it("treats rejected recipients as failure", async () => {
  send.mockResolvedValue({ accepted: [], rejected: [message.to] });
  await expect(sendMail(message)).rejects.toThrow("nicht versendet");
  expect(archiveSentMail).not.toHaveBeenCalled();
});

it("archives the identical MIME bytes after SMTP, including attachments and test recipient", async () => {
  vi.stubEnv("MAIL_TEST_RECIPIENT", "test@example.com");
  await sendMail({ ...message, html: "<p>Hello</p>", attachments: [{ filename: "test.txt", content: Buffer.from("Attachment content") }] });
  const sent = send.mock.calls[0][0];
  expect(archiveSentMail).toHaveBeenCalledWith(sent.raw);
  expect(send.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(archiveSentMail).mock.invocationCallOrder[0]);
  const mime = sent.raw.toString();
  expect(mime).toContain("To: test@example.com");
  expect(mime).toContain("multipart/mixed");
  expect(mime).toContain("text/plain");
  expect(mime).toContain("text/html");
  expect(mime).toContain('filename=test.txt');
  expect(mime).toContain(Buffer.from("Attachment content").toString("base64"));
  expect(mime).toContain(`Message-ID: ${sent.messageId}`);
  expect(sent.envelope.to).toEqual(["test@example.com"]);
});
it("keeps SMTP success when archiving fails and logs no sensitive error details", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(archiveSentMail).mockRejectedValue(new Error("password mail-content"));
  try {
    await expect(sendMail(message)).resolves.toEqual({ messageId: "test-id" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("[mail:archive]"));
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/password|mail-content/);
  } finally { log.mockRestore(); }
});
it("checks authentication without sending a message and sanitizes failures", async () => {
  await verifyMailConnection();
  expect(verify).toHaveBeenCalledTimes(1);
  expect(send).not.toHaveBeenCalled();
  verify.mockRejectedValue(new Error("test-secret"));
  await expect(verifyMailConnection()).rejects.toThrow(/^SMTP-Verbindung fehlgeschlagen/);
});

it("adds the footer inside HTML documents using the configured domain", async () => {
  vi.stubEnv("AUTH_URL", "https://events.example.com");
  await sendMail({ ...message, html: "<html><body><p>Content</p></body></html>" });
  const sent = send.mock.calls[0][0];
  expect(sent.html).toContain('href="https://events.example.com/impressum"');
  expect(sent.html.indexOf("Eventverwaltung GBR")).toBeLessThan(sent.html.indexOf("</body>"));
  expect(sent.text).toContain("https://events.example.com/impressum");
});
