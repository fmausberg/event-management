import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { archiveSentMail } from "@/lib/mail/sent-archive";

const { client, constructor } = vi.hoisted(() => ({
  constructor: vi.fn(),
  client: { connect: vi.fn(), list: vi.fn(), append: vi.fn(), logout: vi.fn(), close: vi.fn(), on: vi.fn(), usable: true },
}));
vi.mock("server-only", () => ({}));
vi.mock("imapflow", () => ({ ImapFlow: class { constructor(options: unknown) { constructor(options); return client; } } }));
const raw = Buffer.from("From: sender@example.com\r\nTo: to@example.com\r\n\r\nTest");
const mailbox = (path: string, specialUse?: string, specialUseSource?: string) => ({ path, name: path.split("/").pop(), specialUse, specialUseSource, flags: new Set() });

beforeEach(() => {
  vi.resetAllMocks();
  for (const [name, value] of Object.entries({
    IMAP_ARCHIVE_ENABLED: "true", IMAP_HOST: "imap.strato.de", IMAP_PORT: "993",
    IMAP_USER: "", IMAP_PASSWORD: "", IMAP_SENT_FOLDER: "",
    SMTP_HOST: "smtp.strato.de", SMTP_USER: "sender@example.com", SMTP_PASSWORD: "secret",
  })) vi.stubEnv(name, value);
  client.usable = true;
  client.list.mockResolvedValue([mailbox("INBOX"), mailbox("INBOX/Sent", "\\Sent", "extension")]);
  client.append.mockResolvedValue({ uid: 1 });
});
afterEach(() => vi.unstubAllEnvs());

it("uses the server Sent role, TLS, SMTP mailbox credentials and Seen flag", async () => {
  await archiveSentMail(raw);
  expect(constructor).toHaveBeenCalledWith(expect.objectContaining({
    host: "imap.strato.de", port: 993, secure: true,
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    auth: { user: "sender@example.com", pass: "secret" }, logger: false, logRaw: false,
  }));
  expect(client.append).toHaveBeenCalledWith("INBOX/Sent", raw, ["\\Seen"]);
  expect(client.logout).toHaveBeenCalledTimes(1);
  expect(client.close).toHaveBeenCalledTimes(1);
});
it("prefers server metadata to name heuristics", async () => {
  client.list.mockResolvedValue([mailbox("Sent", "\\Sent", "name"), mailbox("Postausgang", "\\Sent", "extension")]);
  await archiveSentMail(raw);
  expect(client.append).toHaveBeenCalledWith("Postausgang", raw, ["\\Seen"]);
});
it.each(["Sent", "Gesendet", "Sent Items", "Sent Messages"])("finds an existing %s folder without metadata", async (name) => {
  client.list.mockResolvedValue([mailbox(`INBOX/${name}`)]);
  await archiveSentMail(raw);
  expect(client.append).toHaveBeenCalledWith(`INBOX/${name}`, raw, ["\\Seen"]);
});
it.each([[], [mailbox("Sent"), mailbox("Gesendet")], [{ ...mailbox("Sent"), flags: new Set(["\\Noselect"]) }]])("fails closed for missing or ambiguous selectable folders", async (...boxes) => {
  client.list.mockResolvedValue(boxes);
  await expect(archiveSentMail(raw)).rejects.toThrow();
  expect(client.append).not.toHaveBeenCalled();
  expect(client.close).toHaveBeenCalled();
});
it("accepts only an existing explicit path", async () => {
  vi.stubEnv("IMAP_SENT_FOLDER", "INBOX/Sent");
  await archiveSentMail(raw);
  vi.stubEnv("IMAP_SENT_FOLDER", "Nonexistent");
  await expect(archiveSentMail(raw)).rejects.toThrow();
  expect(client.append).toHaveBeenCalledTimes(1);
});
it.each(["connect", "list", "append", "logout"] as const)("closes connections when %s fails", async (operation) => {
  client[operation].mockRejectedValue(new Error("failure"));
  await expect(archiveSentMail(raw)).rejects.toThrow();
  expect(client.close).toHaveBeenCalledTimes(1);
});
it("rejects unsuccessful APPEND responses", async () => {
  client.append.mockResolvedValue(false);
  await expect(archiveSentMail(raw)).rejects.toThrow();
  expect(client.close).toHaveBeenCalled();
});
it("does not reuse SMTP secrets for a different server", async () => {
  vi.stubEnv("IMAP_HOST", "imap.other.example");
  await expect(archiveSentMail(raw)).rejects.toThrow();
  expect(constructor).not.toHaveBeenCalled();
});
it("uses explicit IMAP credentials and supports disabling archive", async () => {
  vi.stubEnv("IMAP_USER", "sender@example.com"); vi.stubEnv("IMAP_PASSWORD", "imap-secret");
  await archiveSentMail(raw);
  expect(constructor).toHaveBeenCalledWith(expect.objectContaining({ auth: { user: "sender@example.com", pass: "imap-secret" } }));
  vi.stubEnv("IMAP_ARCHIVE_ENABLED", "false");
  await archiveSentMail(raw);
  expect(client.append).toHaveBeenCalledTimes(1);
});
