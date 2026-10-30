import { beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { readReview, saveReview, saveReviewRating } from "@/lib/reviews/service";
import { hashReviewToken } from "@/lib/reviews/token";
import { reviewInput } from "@/lib/reviews/validation";
import { eventReviewMessage } from "@/lib/mail/templates/event-review";
const { db } = vi.hoisted(() => ({ db: { eventReviewResendToken: { findUnique: vi.fn() }, eventReview: { findUnique: vi.fn(), updateMany: vi.fn() }, $transaction: vi.fn() } }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
const token = "a".repeat(43);
const fresh = () => ({ tokenHash: hashReviewToken(token), status: "PROVISIONAL", submittedAt: null as Date | null,
  expiresAt: new Date(Date.now() + 60000), overallRating: null as number | null, trainerRating: null, locationRating: null, organizationRating: null,
  overallComment: null, trainerComment: null, locationComment: null, organizationComment: null,
  event: { name: "Yoga", beginsAt: new Date(0), endsAt: new Date(1), status: "COMPLETED", trainerName: null, trainers: [] }, ticket: { checkedInAt: new Date(1) },
});
let row = fresh();
beforeEach(() => {
  vi.resetAllMocks(); row = fresh();
  db.$transaction.mockImplementation(fn => fn(db));
  db.eventReviewResendToken.findUnique.mockResolvedValue(null);
  db.eventReview.findUnique.mockImplementation(({ where }) => where.tokenHash === row.tokenHash ? { ...row } : null);
  db.eventReview.updateMany.mockImplementation(({ where, data }) => {
    if (row.status !== where.status || row.submittedAt || row.expiresAt <= where.expiresAt.gt) return { count: 0 };
    Object.assign(row, data); return { count: 1 };
  });
});
it("manual reminder tokens share the same feedback and preserve the original link", async () => {
  const reminder = "b".repeat(43);
  db.eventReviewResendToken.findUnique.mockImplementation(({ where }) => where.tokenHash === hashReviewToken(reminder) ? { review: { ...row } } : null);
  expect((await saveReview(reminder, { overallRating: 4 }, false)).state).toBe("saved");
  expect((await readReview(token)).state).toBe("open");
  expect((await saveReview(reminder, { overallRating: 5 }, true)).state).toBe("completed");
  expect((await readReview(token)).state).toBe("completed");
  expect((await saveReview(token, { overallRating: 1 }, false)).state).toBe("completed");
  expect(row.overallRating).toBe(4);
});
it("checks the token hash and never leaks invitation identity", async () => {
  expect(hashReviewToken(token)).not.toBe(token);
  expect(await readReview("b".repeat(43))).toEqual({ state: "invalid" });
  expect(await readReview("bad")).toEqual({ state: "invalid" });
  const read = await readReview(token);
  expect(read.state).toBe("open"); expect(read).not.toHaveProperty("tokenHash"); expect(read).not.toHaveProperty("recipientEmail");
  expect(db.eventReview.updateMany).not.toHaveBeenCalled();
});
it.each([0, 6, 1.5, "5", NaN, Infinity])("rejects invalid ratings %s", async value => {
  expect((await saveReview(token, { overallRating: value }, false)).state).toBe("error");
  expect(db.eventReview.updateMany).not.toHaveBeenCalled();
});
it("keeps optional ratings null and limits every comment", () => {
  expect(reviewInput.parse({ overallRating: 4 }).trainerRating).toBeNull();
  for (const key of ["trainerRating", "locationRating", "organizationRating"]) expect(reviewInput.safeParse({ overallRating: 4, [key]: 0 }).success).toBe(false);
  for (const key of ["overallComment", "trainerComment", "locationComment", "organizationComment"]) expect(reviewInput.safeParse({ overallRating: 4, [key]: "a".repeat(2001) }).success).toBe(false);
});
it("saves individual ratings without overwriting other categories or comments", async () => {
  await saveReviewRating(token, "overallRating", 3);
  await saveReviewRating(token, "locationRating", 5);
  expect(row.overallRating).toBe(3); expect(row.locationRating).toBe(5);
  expect(row.submittedAt).toBeNull();
  await saveReviewRating(token, "locationRating", null);
  expect(row.locationRating).toBeNull();
  await saveReview(token, { overallRating: 1, overallComment: "Danke" }, true);
  expect(row.overallRating).toBe(3); expect(row.overallComment).toBe("Danke");
  expect(row.submittedAt).toBeInstanceOf(Date);
  expect((await saveReviewRating(token, "overallRating", 1)).state).toBe("completed");
  expect(row.overallRating).toBe(3);
});
it("rejects invalid autosaves and finalization without a saved overall rating", async () => {
  for (const [field, value] of [["overallRating", null], ["locationRating", 0], ["submittedAt", 5], ["overallRating", 1.5]]) {
    expect((await saveReviewRating(token, field, value)).state).toBe("error");
  }
  expect((await saveReview(token, { overallRating: 5 }, true)).state).toBe("error");
  expect(db.eventReview.updateMany).not.toHaveBeenCalled();
});
it("allows repeated provisional saves, finalizes only explicitly, and rejects later edits", async () => {
  expect(await saveReview(token, { overallRating: 3 }, false)).toEqual({ state: "saved" });
  expect(row.submittedAt).toBeNull();
  expect((await readReview(token)).state).toBe("open");
  expect(await saveReview(token, { overallRating: 4 }, false)).toEqual({ state: "saved" });
  expect(await saveReview(token, { overallRating: 5, locationRating: 4 }, true)).toEqual({ state: "completed" });
  expect(row.overallRating).toBe(4); expect(row.submittedAt).toBeInstanceOf(Date);
  expect(await saveReview(token, { overallRating: 1 }, false)).toEqual({ state: "completed" });
  row.expiresAt = new Date(0);
  expect(await readReview(token)).toEqual({ state: "completed" });
  expect(row.overallRating).toBe(4);
});
it("fences a concurrent provisional write after final submission", async () => {
  row.overallRating = 4;
  await Promise.all([saveReview(token, { overallRating: 5 }, true), saveReview(token, { overallRating: 1 }, false)]);
  expect(row.overallRating).toBe(4); expect(row.status).toBe("COMPLETED");
});
it("does not accept trainer feedback for an event without trainers", async () => {
  await saveReview(token, { overallRating: 5, trainerRating: 1, trainerComment: "test" }, false);
  expect(row.trainerRating).toBeNull(); expect(row.trainerComment).toBeNull();
});
it("rejects expired tokens, future events and non-attendance on reads and writes", async () => {
  row.expiresAt = new Date(0);
  expect((await saveReview(token, { overallRating: 5 }, true)).state).toBe("invalid");
  row = fresh(); row.event.endsAt = new Date(Date.now() + 60000);
  expect((await readReview(token)).state).toBe("invalid");
  expect((await saveReview(token, { overallRating: 5 }, false)).state).toBe("invalid");
  row = fresh(); Object.assign(row.ticket, { checkedInAt: null });
  expect((await saveReview(token, { overallRating: 5 }, true)).state).toBe("invalid");
  expect(db.eventReview.updateMany).not.toHaveBeenCalled();
});
it("renders five mail links with one secret, distinct ratings and escaped content", () => {
  const mail = eventReviewMessage('<script>"Yoga"</script>', "https://example.com", token);
  const links = [...mail.html.matchAll(/href="([^"]+)"/g)].map(match => new URL(match[1].replaceAll("&amp;", "&")));
  expect(links).toHaveLength(5);
  links.forEach((url, index) => {
    expect(url.pathname).toBe("/reviews"); expect(url.search).toBe("");
    const params = new URLSearchParams(url.hash.slice(1));
    expect(params.get("token")).toBe(token); expect(params.get("rating")).toBe(String(index + 1));
    expect(mail.text).toContain(url.href);
  });
  expect(mail.html).not.toContain("<script>");
});
it("GET stays read-only while the client posts mail selections", () => {
  const page = readFileSync("app/(public)/reviews/page.tsx", "utf8");
  expect(page).not.toMatch(/saveReview|updateReview|searchParams/);
  const form = readFileSync("app/(public)/reviews/review-form.tsx", "utf8");
  const effect = form.slice(form.indexOf("useEffect(() =>"), form.indexOf("async function submit"));
  expect(effect).toContain('updateReviewRating(bearer, "overallRating", selected)');
  expect(form).toContain("void submit()");
});
