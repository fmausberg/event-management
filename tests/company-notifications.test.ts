import { afterEach, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { queueBookingNotification } from "@/lib/companies/notifications";
import { decryptPaymentMail } from "@/lib/payments/mail";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: vi.fn() }));
afterEach(() => vi.unstubAllEnvs());
it("links company notifications to the event and booking and escapes customer details", async () => {
  vi.stubEnv("AUTH_SECRET", "test-secret");
  vi.stubEnv("AUTH_URL", "https://events.example.com");
  const db = {
    booking: { findUniqueOrThrow: vi.fn().mockResolvedValue({ number: 42, quantity: 2, customerName: "Ada <Test>", customerEmail: "ada@example.com", user: { name: "Profile", email: "profile@example.com" }, event: { id: "event-1", name: "Yoga & mehr", companyId: "company", company: { slug: "demo" } } }) },
    companyMembership: { findMany: vi.fn().mockResolvedValue([{ user: { email: "admin@example.com" } }]) },
    mailOutbox: { upsert: vi.fn() },
  };
  await queueBookingNotification(db as unknown as Prisma.TransactionClient, "booking-1");
  const message = decryptPaymentMail(db.mailOutbox.upsert.mock.calls[0][0].create.encryptedMessage);
  expect(message.html).toContain('href="https://events.example.com/company/demo/events/event-1">Yoga &amp; mehr</a>');
  expect(message.html).toContain('href="https://events.example.com/company/demo/bookings?booking=booking-1">#42</a>');
  expect(message.html).toContain("Ada &lt;Test&gt;");
  expect(message.html).toContain("ada@example.com");
  expect(message.text).toContain("https://events.example.com/company/demo/bookings?booking=booking-1");
  expect(message.text).not.toContain("profile@example.com");
});
