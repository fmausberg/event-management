import { beforeEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { saveVenue, deleteVenue } from "@/app/company/[companyKey]/venues/actions";
import Page from "@/app/company/[companyKey]/venues/page";
import { getCompanyVenues } from "@/lib/venues/data";
import { venueSchema } from "@/lib/venues/validation";
const { auth, db } = vi.hoisted(() => ({ auth: vi.fn(), db: {
 eventReview: { groupBy: vi.fn() },
 user: { findUnique: vi.fn() }, company: { findUnique: vi.fn() }, companyMembership: { findUnique: vi.fn() },
 venue: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
} }));
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("LOGIN"); }, notFound: () => { throw new Error("NOT_FOUND"); } }));
const values = { name: " Studio ", addressLine1: " Street 1 ", addressLine2: "", postalCode: "01234", city: "Berlin", countryCode: "de" };
function form(overrides: Record<string,string> = {}) { const data = new FormData(); Object.entries({ ...values, ...overrides }).forEach(([key,value]) => data.set(key,value)); return data; }
beforeEach(() => {
 vi.resetAllMocks(); auth.mockResolvedValue({ user: { id: "actor" } }); db.user.findUnique.mockResolvedValue({ role: "ADMIN" });
 db.eventReview.groupBy.mockResolvedValue([]);
 db.company.findUnique.mockResolvedValue({ id: "company-id", slug: "yoga", name: "Yoga" });
 db.venue.findMany.mockResolvedValue([]);
 db.venue.updateMany.mockResolvedValue({ count: 1 }); db.venue.deleteMany.mockResolvedValue({ count: 1 });
});
it("creates with trusted company and normalized address", async () => {
 expect((await saveVenue("yoga", null, {}, form({ companyId: "foreign", createdById: "foreign" }))).success).toBe(true);
 expect(db.venue.create).toHaveBeenCalledWith({ data: expect.objectContaining({ name: "Studio", companyId: "company-id", addressLine1: "Street 1", countryCode: "DE", postalCode: "01234", addressLine2: null }) });
});
it("scopes updates and deletes to company and preserves events", async () => {
 await saveVenue("yoga", "series-1", {}, form());
 expect(db.venue.updateMany).toHaveBeenCalledWith({ where: { id: "series-1", companyId: "company-id" }, data: expect.any(Object) });
 await deleteVenue("yoga", "series-1", {}, form({ confirmed: "yes" }));
 expect(db.venue.deleteMany).toHaveBeenCalledWith({ where: { id: "series-1", companyId: "company-id", events: { none: {} }, suggestedForSeries: { none: {} } } });
});
it.each(["COMPANY_USER", "COMPANY_ADMIN"])("allows active %s", async (role) => {
 db.user.findUnique.mockResolvedValue({ role: "USER" }); db.companyMembership.findUnique.mockResolvedValue({ role, status: "ACTIVE" });
 expect((await saveVenue("yoga", null, {}, form())).success).toBe(true);
});
it.each([null, { role: "COMPANY_ADMIN", status: "SUSPENDED" }, { role: "COMPANY_ADMIN", status: "INVITED" }])("denies insufficient membership %j", async (membership) => {
 db.user.findUnique.mockResolvedValue({ role: "USER" }); db.companyMembership.findUnique.mockResolvedValue(membership);
 await expect(getCompanyVenues("yoga")).rejects.toThrow();
 expect((await saveVenue("yoga", null, {}, form())).success).toBeUndefined();
 expect((await deleteVenue("yoga", "series-1", {}, form({ confirmed: "yes" }))).success).toBeUndefined();
 expect(db.venue.create).not.toHaveBeenCalled(); expect(db.venue.deleteMany).not.toHaveBeenCalled();
});
it("rejects missing confirmation, missing series and linked events", async () => {
 expect((await deleteVenue("yoga", "series-1", {}, form())).success).toBeUndefined();
 expect(db.venue.deleteMany).not.toHaveBeenCalled();
 db.venue.deleteMany.mockResolvedValue({ count: 0 }); db.venue.updateMany.mockResolvedValue({ count: 0 });
 expect((await deleteVenue("yoga", "series-1", {}, form({ confirmed: "yes" }))).success).toBeUndefined();
 expect((await saveVenue("yoga", "series-1", {}, form())).success).toBeUndefined();
});
it.each([{ name: " " }, { countryCode: "DEU" }, { countryCode: "12" }, { city: "x".repeat(161) }])("validates inputs %j", (invalid) => { expect(venueSchema.safeParse({ ...values, ...invalid }).success).toBe(false); });
it("renders empty table and create option, and redirects guests", async () => {
 const props = { params: Promise.resolve({ companyKey: "yoga" }) };
 const html = renderToStaticMarkup(await Page(props));
 expect(html).toContain("Noch keine Venues vorhanden"); expect(html).toContain("+ Venue erstellen");
 auth.mockResolvedValue(null); await expect(Page(props)).rejects.toThrow("LOGIN");
 expect((await saveVenue("yoga", null, {}, form())).success).toBeUndefined();
});
it("scopes listing and returns relation counts", async () => {
 await getCompanyVenues("yoga");
 expect(db.venue.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId: "company-id" }, select: expect.objectContaining({ _count: { select: { events: true, suggestedForSeries: true } } }) }));
});
it("handles a concurrent foreign-key reference safely", async () => {
 db.venue.deleteMany.mockRejectedValue(new Error("foreign key"));
 expect((await deleteVenue("yoga", "venue-1", {}, form({ confirmed: "yes" }))).success).toBeUndefined();
});
