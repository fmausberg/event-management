import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getEventTickets } from "@/lib/tickets/management";
import { redeemCompanyTicket } from "@/app/company/[companyKey]/events/[eventId]/tickets/actions";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import Page from "@/app/company/[companyKey]/events/[eventId]/tickets/page";
const { access, event, tickets, update } = vi.hoisted(() => ({ update: vi.fn(), access: vi.fn(), event: vi.fn(), tickets: vi.fn() }));
const { member, reviews } = vi.hoisted(() => ({ member: vi.fn(), reviews: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "actor" } })) }));
vi.mock("@/lib/tickets/access", () => ({ requireEventTicketAccess: access }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => ({ companyMembership: { findUnique: member }, eventReview: { findMany: reviews }, event: { findFirst: event }, ticket: { findMany: tickets, updateMany: update } }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: () => { throw new Error("LOGIN"); } }));
const props = { params: Promise.resolve({ companyKey: "yoga", eventId: "event" }) };
beforeEach(() => { vi.resetAllMocks(); access.mockResolvedValue({ actor: "actor", company: { id: "company", name: "Studio" }, event: { id: "event", name: "Yoga", beginsAt: new Date("2026-10-16T15:30Z"), status: "PUBLISHED" } }); event.mockResolvedValue({ id: "event", name: "Yoga", beginsAt: new Date("2026-10-16T15:30Z"), status: "PUBLISHED" }); tickets.mockResolvedValue([]); });
it("scopes the event and tickets to the authorized company", async () => {
 await getEventTickets("yoga", "event");
 expect(access).toHaveBeenCalledWith("yoga", "event");
 expect(tickets).toHaveBeenCalledWith(expect.objectContaining({ where: { booking: { eventId: "event", event: { companyId: "company" } } } }));
 expect(JSON.stringify(tickets.mock.calls)).not.toContain("publicTokenHash");
});
it("rejects foreign events and unauthorized users before reading tickets", async () => {
 access.mockRejectedValue(new Error("forbidden")); await expect(getEventTickets("yoga", "foreign")).rejects.toThrow();
 access.mockRejectedValue(new Error("forbidden")); await expect(getEventTickets("other", "event")).rejects.toThrow();
 expect(tickets).not.toHaveBeenCalled();
});
it("renders an empty table", async () => { expect(renderToStaticMarkup(await Page(props))).toContain("Noch keine Tickets vorhanden."); });
it.each(["COMPANY_USER", "COMPANY_ADMIN"])("shows review status and resend controls for %s", async role => {
 member.mockResolvedValue({ role, status: "ACTIVE" });
 reviews.mockResolvedValue([{ recipientEmail: "holder@example.com", status: "COMPLETED", overallRating: 5, submittedAt: new Date(), sentAt: new Date() }]);
 tickets.mockResolvedValue([{ id: "ticket", number: 1, status: "VALID", checkedInAt: new Date(), booking: { number: 1, status: "CONFIRMED", customerEmail: "Holder@Example.com" } }]);
 const html = renderToStaticMarkup(await Page(props));
 expect(html).toContain("Abgegeben"); expect(html).toContain("Bewertungsaufforderung senden");
 expect(html).toContain("Bewertung bereits abgegeben.");
});
it("never reads review status for staff without active company membership", async () => {
 member.mockResolvedValue(null);
 const html = renderToStaticMarkup(await Page(props));
 expect(html).not.toContain("Bewertungsaufforderung"); expect(reviews).not.toHaveBeenCalled();
});
it("redeems only unused valid tickets in the authorized company and event", async () => {
 update.mockResolvedValue({ count: 1 });
 expect((await redeemCompanyTicket("yoga", "event", "ticket", {}, new FormData())).message).toBe("Ticket eingelöst.");
 expect(update).toHaveBeenCalledWith({ where: { id: "ticket", status: "VALID", checkedInAt: null, booking: { eventId: "event", status: "CONFIRMED", event: { companyId: "company", status: { not: "CANCELLED" } } } }, data: { checkedInAt: expect.any(Date), checkedInById: "actor" } });
 update.mockResolvedValue({ count: 0 });
 expect((await redeemCompanyTicket("yoga", "event", "ticket", {}, new FormData())).message).toContain("bereits eingelöst");
});
it("does not write when company access is denied", async () => {
 access.mockRejectedValue(new Error("denied"));
 await redeemCompanyTicket("other", "event", "ticket", {}, new FormData());
 expect(update).not.toHaveBeenCalled();
});
it("renders current effective statuses and redemption time", async () => {
 const base = { id: "1", number: 1, status: "VALID", checkedInAt: null, booking: { number: 42, status: "CONFIRMED", customerEmail: "holder@example.com" } };
 tickets.mockResolvedValue([base, { ...base, id: "2", checkedInBy: { email: "scanner@example.com" }, checkedInAt: new Date("2026-10-13T14:30Z") }, { ...base, id: "3", booking: { number: 43, status: "CANCELLED" } }]);
 const html = renderToStaticMarkup(await Page(props));
 for (const value of ["eingelöst von ", "scanner@example.com", "holder@example.com", "Einlösen", "Gültig", "eingelöst", "16:30:00", "Storniert", "bg-green-100", "bg-yellow-100", "bg-red-100"]) expect(html).toContain(value);
});
