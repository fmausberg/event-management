import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cancelAutomaticTrainerReminders, enqueueDueTrainerReminders, requestTrainerReminderNow } from "@/lib/trainers/reminders";

const { db, sendMail } = vi.hoisted(() => ({
  db: {
    $transaction: vi.fn(),
    event: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    trainerReminder: { upsert: vi.fn(), findUnique: vi.fn() },
    mailOutbox: { updateMany: vi.fn(), createMany: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
    booking: { aggregate: vi.fn() },
  }, sendMail: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("@/lib/mail", () => ({ sendMail }));
vi.mock("@/lib/auth/verification", () => ({ accountOrigin: () => "https://example.com" }));

beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation((work) => work(db));
  db.mailOutbox.updateMany.mockResolvedValue({ count: 1 });
});
afterEach(() => vi.unstubAllEnvs());

it("retires only unsent automatic trainer jobs, including previously cancelled jobs", async () => {
  await cancelAutomaticTrainerReminders();
  expect(db.mailOutbox.updateMany).toHaveBeenCalledWith({
    where: { kind: "TRAINER_REMINDER", sentAt: null, trainerReminder: { is: { manualRequestedAt: null } } },
    data: { cancelledAt: expect.any(Date), lockedUntil: null, lockToken: null, lastError: "AUTOMATIC_TRAINER_REMINDERS_DISABLED" },
  });
  expect(sendMail).not.toHaveBeenCalled();
});

it("keeps stable automatic keys and excludes retired jobs from revival after reactivation", async () => {
  db.event.findMany.mockResolvedValue([{ id: "event" }]);
  db.event.findFirst.mockResolvedValue({ id: "event", trainers: [{ trainerId: "trainer" }] });
  db.trainerReminder.upsert.mockResolvedValue({ id: "reminder" });
  db.mailOutbox.createMany.mockResolvedValue({ count: 0 });
  await enqueueDueTrainerReminders();
  expect(db.trainerReminder.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { requestKey: "trainer-reminder:auto:event" } }));
  expect(db.mailOutbox.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true, data: [expect.objectContaining({ requestKey: "trainer-reminder:auto:event:trainer" })] }));
  expect(db.mailOutbox.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
    cancelledAt: { not: null }, OR: [{ lastError: null }, { lastError: { not: "AUTOMATIC_TRAINER_REMINDERS_DISABLED" } }],
  }) }));
});

it("sends a manual request immediately even with automation disabled", async () => {
  vi.stubEnv("AUTO_TRAINER_REMINDERS_ENABLED", "false");
  const event = {
    id: "event", name: "Training", status: "PUBLISHED", beginsAt: new Date(Date.now() + 86400_000),
    trainerReminderSentAt: null, trainers: [{ trainerId: "trainer" }], company: { slug: "studio" }, venue: null,
  };
  db.event.findFirst.mockResolvedValue(event);
  db.trainerReminder.upsert.mockResolvedValue({ id: "manual" });
  db.mailOutbox.findMany.mockResolvedValue([{ id: "mail" }]);
  db.mailOutbox.findFirst.mockResolvedValue({
    attempts: 1, trainerReminderId: "manual", trainerReminder: { manualRequestedAt: new Date(), event },
    trainer: { id: "trainer", firstName: "Ada", lastName: "Test", email: "trainer@example.com" },
  });
  db.booking.aggregate.mockResolvedValue({ _sum: { quantity: 4 } });
  db.trainerReminder.findUnique.mockResolvedValue({ manualRequestedAt: new Date(), event });
  db.mailOutbox.count.mockResolvedValue(1);
  db.event.findUnique.mockResolvedValue({ trainerReminderSentAt: new Date() });
  const result = await requestTrainerReminderNow("event", "company", "12345678-1234-4123-8123-123456789abc");
  expect(result).toMatchObject({ available: true, delivered: 1, failures: 0, sent: true });
  expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "trainer@example.com" }));
  expect(db.trainerReminder.upsert).toHaveBeenCalledWith(expect.objectContaining({
    create: expect.objectContaining({ manualRequestedAt: expect.any(Date), requestKey: "trainer-reminder:manual:event:12345678-1234-4123-8123-123456789abc" }),
  }));
});
