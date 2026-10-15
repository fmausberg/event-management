import { beforeEach, expect, it, vi } from "vitest";
import { requireEventTicketAccess } from "@/lib/tickets/access";
import { getEventTickets } from "@/lib/tickets/management";
import { redeemCompanyTicket } from "@/app/company/[companyKey]/events/[eventId]/tickets/actions";

const { auth, db } = vi.hoisted(() => ({ auth: vi.fn(), db: {
  user: { findUnique: vi.fn(), findMany: vi.fn() }, event: { findFirst: vi.fn() }, ticket: { findMany: vi.fn(), updateMany: vi.fn() },
} }));
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const event = { id: "event", name: "Yoga", beginsAt: new Date(), status: "PUBLISHED", company: { id: "company", slug: "yoga", name: "Yoga" } };
beforeEach(() => {
  vi.resetAllMocks(); auth.mockResolvedValue({ user: { id: "actor" } });
  db.user.findUnique.mockResolvedValue({ id: "actor", email: "ada@example.com", role: "USER" });
  db.user.findMany.mockResolvedValue([{ id: "actor" }]);
  db.event.findFirst.mockResolvedValue(event); db.ticket.findMany.mockResolvedValue([]); db.ticket.updateMany.mockResolvedValue({ count: 1 });
});
it("restricts access to the requested event/company and an active membership, trainer or staff assignment", async () => {
  await requireEventTicketAccess("yoga", "event");
  expect(db.event.findFirst.mock.calls[0][0].where).toEqual({
    id: "event", company: { slug: "yoga" }, OR: [
      { company: { memberships: { some: { userId: "actor", status: "ACTIVE" } } } },
      { trainers: { some: { trainer: { OR: [{ userId: "actor" }] } } } },
      { staff: { some: { userId: "actor" } } },
      { venue: { staff: { some: { userId: "actor" } } } },
    ],
  });
});
it("retains global administrator access while enforcing the event/company pair", async () => {
  db.user.findUnique.mockResolvedValue({ id: "actor", email: "ada@example.com", role: "ADMIN" });
  await requireEventTicketAccess("yoga", "event");
  expect(db.event.findFirst.mock.calls[0][0].where).toEqual({ id: "event", company: { slug: "yoga" } });
});
it("never grants email-based trainer access when the account email is ambiguous", async () => {
  db.user.findMany.mockResolvedValue([{ id: "actor" }, { id: "other" }]);
  await requireEventTicketAccess("yoga", "event");
  expect(db.event.findFirst.mock.calls[0][0].where.OR[1]).toEqual({ trainers: { some: { trainer: { OR: [{ userId: "actor" }] } } } });
});
it("denies guests and deleted users before event or ticket queries", async () => {
  auth.mockResolvedValue(null); await expect(getEventTickets("yoga", "event")).rejects.toMatchObject({ reason: "UNAUTHENTICATED" });
  auth.mockResolvedValue({ user: { id: "deleted" } }); db.user.findUnique.mockResolvedValue(null);
  await expect(getEventTickets("yoga", "event")).rejects.toMatchObject({ reason: "UNAUTHENTICATED" });
  expect(db.event.findFirst).not.toHaveBeenCalled(); expect(db.ticket.findMany).not.toHaveBeenCalled();
});
it("prevents ticket reads and redemption when the event permission query finds no match", async () => {
  db.event.findFirst.mockResolvedValue(null);
  await expect(getEventTickets("foreign", "other-event")).rejects.toMatchObject({ reason: "FORBIDDEN" });
  await redeemCompanyTicket("foreign", "other-event", "ticket", {}, new FormData());
  expect(db.ticket.findMany).not.toHaveBeenCalled(); expect(db.ticket.updateMany).not.toHaveBeenCalled();
});
it("checks permissions afresh before redemption after an assignment is removed", async () => {
  await getEventTickets("yoga", "event");
  expect((await redeemCompanyTicket("yoga", "event", "ticket", {}, new FormData())).message).toBe("Ticket eingelöst.");
  db.ticket.updateMany.mockClear(); db.event.findFirst.mockResolvedValue(null);
  await redeemCompanyTicket("yoga", "event", "ticket", {}, new FormData());
  expect(db.ticket.updateMany).not.toHaveBeenCalled();
});
