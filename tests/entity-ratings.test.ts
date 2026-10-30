import { beforeEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getCompanyEntityRatings } from "@/lib/reviews/entity-ratings";
import { ratingSummary, formatRatingSummary } from "@/lib/reviews/summary";
import { RatingSummary } from "@/components/rating-summary";
import { getCompanyTrainers } from "@/lib/trainers/data";
import { getCompanyVenues } from "@/lib/venues/data";

const { db, access } = vi.hoisted(() => ({ access: vi.fn(), db: {
  eventReview: { groupBy: vi.fn() }, event: { findMany: vi.fn() },
  trainer: { findMany: vi.fn() }, venue: { findMany: vi.fn() }, user: { findMany: vi.fn() },
} }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("@/lib/companies/members", () => ({ requireCompanyAccess: access, MemberAccessError: class extends Error {} }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
const event = (id: string, trainers: string[], venueId: string | null = "venue") => ({ id, trainers: trainers.map(trainerId => ({ trainerId })), venue: venueId ? { id: venueId, companyId: "company" } : null });
beforeEach(() => {
  vi.resetAllMocks(); access.mockResolvedValue({ company: { id: "company" } });
  db.eventReview.groupBy.mockResolvedValue([]); db.event.findMany.mockResolvedValue([]);
  db.trainer.findMany.mockResolvedValue([{ id: "trainer", email: "trainer@example.com" }]);
  db.user.findMany.mockResolvedValue([]); db.venue.findMany.mockResolvedValue([{ id: "venue" }]);
});
it.each(["trainer", "venue"] as const)("filters %s aggregates to final non-null company answers", async category => {
  await getCompanyEntityRatings("company", category);
  expect(db.eventReview.groupBy).toHaveBeenCalledWith({
    by: ["eventId"], where: { status: "COMPLETED", submittedAt: { not: null },
      [category === "trainer" ? "trainerRating" : "locationRating"]: { not: null }, event: { companyId: "company" } },
    _sum: { trainerRating: true, locationRating: true }, _count: { trainerRating: true, locationRating: true },
  });
  expect(db.event.findMany).not.toHaveBeenCalled();
});
it("weights individual responses across events and shares the event score with assigned trainers", async () => {
  db.eventReview.groupBy.mockResolvedValue([
    { eventId: "a", _sum: { trainerRating: 20, locationRating: 8 }, _count: { trainerRating: 4, locationRating: 2 } },
    { eventId: "b", _sum: { trainerRating: 3, locationRating: 10 }, _count: { trainerRating: 1, locationRating: 5 } },
  ]);
  db.event.findMany.mockResolvedValue([event("a", ["t1", "t2"]), event("b", ["t1"])]);
  const result = await getCompanyEntityRatings("company", "trainer");
  expect(result.get("t1")).toEqual({ count: 5, average: 4.6 });
  expect(result.get("t2")).toEqual({ count: 4, average: 5 });
  expect(db.eventReview.groupBy).toHaveBeenCalledTimes(1); expect(db.event.findMany).toHaveBeenCalledTimes(1);
  expect(db.event.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { companyId: "company", id: { in: ["a", "b"] } },
    select: expect.objectContaining({ trainers: { where: { trainer: { companyId: "company" } }, select: { trainerId: true } } }),
  }));
});
it("groups locations independently and never attributes foreign or missing venues", async () => {
  db.eventReview.groupBy.mockResolvedValue([
    { eventId: "a", _sum: { trainerRating: 5, locationRating: 20 }, _count: { trainerRating: 1, locationRating: 4 } },
    { eventId: "b", _sum: { trainerRating: null, locationRating: 3 }, _count: { trainerRating: 0, locationRating: 1 } },
    { eventId: "c", _sum: { trainerRating: 5, locationRating: 25 }, _count: { trainerRating: 1, locationRating: 5 } },
    { eventId: "missing", _sum: { trainerRating: null, locationRating: 25 }, _count: { trainerRating: 0, locationRating: 5 } },
  ]);
  db.event.findMany.mockResolvedValue([event("a", []), event("b", []), { ...event("c", []), venue: { id: "foreign", companyId: "other" } }]);
  const result = await getCompanyEntityRatings("company", "venue");
  expect([...result]).toEqual([["venue", { count: 5, average: 4.6 }]]);
});
it("ignores events without explicit trainer assignments, including legacy names", async () => {
  db.eventReview.groupBy.mockResolvedValue([{ eventId: "a", _sum: { trainerRating: 25 }, _count: { trainerRating: 5 } }]);
  db.event.findMany.mockResolvedValue([event("a", [])]);
  expect((await getCompanyEntityRatings("company", "trainer")).size).toBe(0);
});
it("shows averages from the first answer with German formatting in both tables", () => {
  expect(formatRatingSummary(ratingSummary(0, 0))).toBe("Noch keine Bewertungen");
  expect(formatRatingSummary(ratingSummary(5, 1))).toBe("5,0 ★ (1 Bewertung)");
  expect(formatRatingSummary(ratingSummary(20, 4))).toBe("5,0 ★ (4 Bewertungen)");
  expect(formatRatingSummary(ratingSummary(23, 5))).toBe("4,6 ★ (5 Bewertungen)");
  expect(formatRatingSummary(ratingSummary(55, 12))).toBe("4,6 ★ (12 Bewertungen)");
  const html = renderToStaticMarkup(createElement(RatingSummary, { rating: ratingSummary(23, 5) }));
  expect(html).toContain('4,6 ★ <span class="text-zinc-500 dark:text-zinc-400">(5 Bewertungen)</span>');
});
it.each([getCompanyTrainers, getCompanyVenues])("does not query any feedback without authorization", async getList => {
  access.mockRejectedValue(new Error("FORBIDDEN"));
  await expect(getList("foreign-company")).rejects.toThrow("FORBIDDEN");
  expect(db.eventReview.groupBy).not.toHaveBeenCalled(); expect(db.event.findMany).not.toHaveBeenCalled();
});
it("attaches only aggregate summaries to the authorized list rows", async () => {
  const trainers = await getCompanyTrainers("slug"); const venues = await getCompanyVenues("slug");
  expect(trainers.trainers[0].rating).toEqual({ count: 0, average: null });
  expect(venues.venues[0].rating).toEqual({ count: 0, average: null });
  for (const [args] of db.eventReview.groupBy.mock.calls) expect(args.where.event).toEqual({ companyId: "company" });
  expect(JSON.stringify(db.eventReview.groupBy.mock.calls)).not.toMatch(/Comment|recipientEmail/);
});
