import { beforeEach, expect, it, vi } from "vitest";
import { getCompanyBookings } from "@/lib/bookings/company";
const { auth, db } = vi.hoisted(() => ({ auth: vi.fn(), db: {
  user: { findUnique: vi.fn() }, company: { findUnique: vi.fn() },
  companyMembership: { findUnique: vi.fn() }, booking: { findMany: vi.fn() },
} }));
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
beforeEach(() => {
  vi.resetAllMocks();
  auth.mockResolvedValue({ user: { id: "actor" } });
  db.user.findUnique.mockResolvedValue({ role: "USER" });
  db.company.findUnique.mockResolvedValue({ id: "company", slug: "demo", name: "Demo" });
  db.companyMembership.findUnique.mockResolvedValue({ status: "ACTIVE", role: "COMPANY_USER" });
  db.booking.findMany.mockResolvedValue([]);
});
it.each(["COMPANY_USER", "COMPANY_ADMIN"])("scopes all event bookings to the company for %s", async role => {
  db.companyMembership.findUnique.mockResolvedValue({ status: "ACTIVE", role });
  await getCompanyBookings("demo");
  expect(db.booking.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { event: { companyId: "company" } } }));
});
it("rejects inactive members before reading bookings", async () => {
  db.companyMembership.findUnique.mockResolvedValue({ status: "SUSPENDED", role: "COMPANY_ADMIN" });
  await expect(getCompanyBookings("demo")).rejects.toThrow("Du darfst");
  expect(db.booking.findMany).not.toHaveBeenCalled();
});
it("uses booking price snapshots, customer fallback and serializable event end times", async () => {
  db.booking.findMany.mockResolvedValue([{
    id: "booking", number: 7, customerName: null, customerEmail: null, quantity: 2,
    status: "CONFIRMED", bookedAt: new Date("2026-11-01T12:00Z"), platform: null, externalBookingId: null,
    payment: { status: "PAID", amount: 1000, currency: "EUR" },
    price: { originalAmountMinor: 2000, payableAmountMinor: 1000, currency: "EUR" },
    user: { name: "Ada", email: "ada@example.com" }, tickets: [],
    event: { id: "event", name: "Kurs", status: "PUBLISHED", beginsAt: new Date("2026-11-10T12:00Z"), endsAt: new Date("2026-11-10T14:00Z"), ticketPrice: null, currency: "EUR" },
  }]);
  const { bookings } = await getCompanyBookings("demo");
  expect(bookings[0]).toMatchObject({ customerName: "Ada", customerEmail: "ada@example.com", paidAmount: 1000, event: { endsAt: "2026-11-10T14:00:00.000Z" } });
  expect(bookings[0].paymentSummary).toContain("-50");
  expect(bookings[0]).not.toHaveProperty("tickets");
});
