import { beforeEach, expect, it, vi } from "vitest";
import { getReviewSummary } from "@/lib/reviews/management";
const { db, auth } = vi.hoisted(() => ({ auth: vi.fn(), db: {
  user: { findUnique: vi.fn() }, company: { findUnique: vi.fn() }, companyMembership: { findUnique: vi.fn() },
  event: { findFirst: vi.fn() }, eventReview: { count: vi.fn(), aggregate: vi.fn() },
} }));
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
beforeEach(() => {
  vi.resetAllMocks(); auth.mockResolvedValue({ user: { id: "user" } });
  db.user.findUnique.mockResolvedValue({ role: "USER" });
  db.company.findUnique.mockResolvedValue({ id: "company", slug: "yoga", name: "Yoga" });
  db.companyMembership.findUnique.mockResolvedValue({ role: "COMPANY_USER", status: "ACTIVE" });
  db.event.findFirst.mockResolvedValue({ id: "event" });
  db.eventReview.count.mockResolvedValue(0); db.eventReview.aggregate.mockResolvedValue({});
});
it("scopes members to the company event and aggregates only completed scores", async () => {
  await getReviewSummary("yoga", "event");
  expect(db.event.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "event", companyId: "company" } }));
  expect(db.eventReview.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: { eventId: "event", status: "COMPLETED" } }));
});
it("allows platform admins without granting global access to company users", async () => {
  db.user.findUnique.mockResolvedValue({ role: "ADMIN" });
  db.companyMembership.findUnique.mockResolvedValue(null);
  await expect(getReviewSummary("yoga", "event")).resolves.toHaveProperty("invited");
});
it.each([null, { role: "COMPANY_ADMIN", status: "SUSPENDED" }])("rejects missing or suspended membership", async membership => {
  db.companyMembership.findUnique.mockResolvedValue(membership);
  await expect(getReviewSummary("yoga", "event")).rejects.toThrow();
  expect(db.eventReview.count).not.toHaveBeenCalled();
});
it("rejects unauthenticated and cross-company requests before querying reviews", async () => {
  auth.mockResolvedValue(null);
  await expect(getReviewSummary("yoga", "event")).rejects.toThrow();
  auth.mockResolvedValue({ user: { id: "user" } }); db.event.findFirst.mockResolvedValue(null);
  await expect(getReviewSummary("yoga", "foreign-event")).rejects.toThrow();
  expect(db.eventReview.count).not.toHaveBeenCalled();
});
