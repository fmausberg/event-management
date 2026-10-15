import { beforeEach, expect, it, vi } from "vitest";
import { notifyAssignment } from "@/lib/mail/assignment";
import { sendMail } from "@/lib/mail";
const { db, access, rate } = vi.hoisted(() => ({ access: vi.fn(), rate: vi.fn(), db: {
  eventStaff: { findFirst: vi.fn() }, venueStaff: { findFirst: vi.fn() }, trainer: { findFirst: vi.fn() }, companyMembership: { findFirst: vi.fn() }, user: { findUnique: vi.fn(), findMany: vi.fn() },
} }));
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "actor" } }) }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("@/lib/companies/members", () => ({ requireCompanyAccess: access }));
vi.mock("@/lib/auth/rate-limit", () => ({ consumeAuthAttempt: rate }));
vi.mock("@/lib/mail", () => ({ sendMail: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks(); access.mockResolvedValue({ company: { id: "company", name: "Yoga" } }); rate.mockResolvedValue(true);
  db.eventStaff.findFirst.mockResolvedValue({ email: "ada@example.com", assignedById: "original-actor", eventId: "event-1", event: { name: "Yoga Class" } });
  db.user.findMany.mockResolvedValue([]);
  db.user.findUnique.mockResolvedValue({ name: "<Ada>", email: "actor@example.com" });
});
it("sends assignment context and a normal registration button without any permission token", async () => {
  expect((await notifyAssignment("event", "yoga", "assignment")).success).toBe(true);
  expect(db.eventStaff.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "assignment", event: { companyId: "company" } } }));
  expect(db.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "original-actor" } }));
  const mail = vi.mocked(sendMail).mock.calls[0][0];
  expect(mail.text).toContain("Event-Staff"); expect(mail.text).toContain("Yoga Class");
  expect(mail.html).toContain("&lt;Ada&gt;"); expect(mail.html).toMatch(/href="https?:[^"?#]+\/register"/);
  expect(mail.text).not.toContain("verify-email#");
});
it("requires company-admin permissions for membership notices", async () => {
  db.companyMembership.findFirst.mockResolvedValue({ email: "ada@example.com", role: "COMPANY_ADMIN" });
  await notifyAssignment("member", "yoga", "assignment"); expect(access).toHaveBeenCalledWith("yoga", true);
});
it("never sends for unauthorized or missing assignments", async () => {
  access.mockRejectedValueOnce(new Error("forbidden"));
  expect((await notifyAssignment("event", "foreign", "assignment")).success).toBe(false);
  db.eventStaff.findFirst.mockResolvedValue(null);
  expect((await notifyAssignment("event", "yoga", "missing")).success).toBe(false);
  expect(sendMail).not.toHaveBeenCalled();
});
it("reports failed delivery without changing or removing the assignment", async () => {
  vi.mocked(sendMail).mockRejectedValue(new Error("SMTP failure"));
  const result = await notifyAssignment("event", "yoga", "assignment");
  expect(result.success).toBe(false); expect(result.message).toContain("bleibt gespeichert");
});
it("rate limits resend requests", async () => {
  rate.mockResolvedValue(false); await notifyAssignment("event", "yoga", "assignment");
  expect(sendMail).not.toHaveBeenCalled();
});

it.each([false, true])("tailors notification to existing account verification: %s", async (verified) => {
  db.user.findMany.mockResolvedValue([{ email: "ada@example.com", emailVerified: verified ? new Date() : null }]);
  expect((await notifyAssignment("event", "yoga", "assignment")).success).toBe(true);
  const mail = vi.mocked(sendMail).mock.calls[0][0];
  expect(mail.text).not.toContain("Erstelle dein Konto");
  expect(mail.text).not.toContain("Berechtigungstoken");
  expect(mail.html).not.toContain("/register");
  if (verified) {
    expect(mail.html).toContain('/company/yoga/events/event-1/tickets">Yoga Class</a>');
    expect(mail.text).toContain('/company/yoga/events/event-1/tickets');
    expect(mail.text).not.toContain('/verify-email');
  } else {
    expect(mail.text).toContain('/verify-email');
    expect(mail.html).not.toContain('/tickets');
  }
});
it("does not send when the recipient lookup fails", async () => {
  db.user.findMany.mockRejectedValue(new Error("lookup failure"));
  expect((await notifyAssignment("event", "yoga", "assignment")).success).toBe(false);
  expect(sendMail).not.toHaveBeenCalled();
});
