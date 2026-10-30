// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReviewForm } from "@/app/(public)/reviews/review-form";
const { loadReview, updateReview, updateReviewRating } = vi.hoisted(() => ({ loadReview: vi.fn(), updateReview: vi.fn(), updateReviewRating: vi.fn() }));
vi.mock("@/app/(public)/reviews/actions", () => ({ loadReview, updateReview, updateReviewRating }));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  window.location.hash = `token=${"a".repeat(43)}&rating=4`;
  loadReview.mockResolvedValue({ state: "open", eventName: "Yoga", date: "2026-10-29T12:00:00Z", hasTrainer: false,
    overallRating: null, trainerRating: null, locationRating: null, organizationRating: null,
    overallComment: null, trainerComment: null, locationComment: null, organizationComment: null });
  updateReview.mockResolvedValue({ state: "saved" });
  updateReviewRating.mockResolvedValue({ state: "saved" });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); window.location.hash = ""; });
it("opening a mail star saves the overall value; details remain empty", async () => {
  await act(async () => root.render(createElement(ReviewForm)));
  expect(host.querySelector<HTMLInputElement>('input[name="overallRating"]:checked')?.value).toBe("4");
  expect(host.querySelector('input[name="locationRating"]:checked')).toBeNull();
  expect(host.querySelector('input[name="organizationRating"]:checked')).toBeNull();
  expect(host.querySelector('input[name="trainerRating"]')).toBeNull();
  expect(host.textContent).toContain("Nicht bewertet");
  expect(updateReview).not.toHaveBeenCalled();
  expect(updateReviewRating).toHaveBeenCalledWith("a".repeat(43), "overallRating", 4);
});
it("star clicks save immediately, only submit completes and shows thanks", async () => {
  await act(async () => root.render(createElement(ReviewForm)));
  await act(async () => host.querySelector<HTMLInputElement>('input[name="locationRating"][value="2"]')!.click());
  expect(updateReviewRating).toHaveBeenLastCalledWith("a".repeat(43), "locationRating", 2);
  expect(host.textContent).toContain("Vorläufig gespeichert");
  updateReview.mockResolvedValue({ state: "completed" });
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(updateReview).toHaveBeenLastCalledWith("a".repeat(43), expect.objectContaining({ overallRating: 4 }), true);
  expect(host.textContent).toContain("Vielen Dank!");
  expect(host.querySelector('a[href="/events"]')).not.toBeNull();
});
it("reopening a completed link shows a confirmation without editable inputs", async () => {
  loadReview.mockResolvedValue({ state: "completed" });
  await act(async () => root.render(createElement(ReviewForm)));
  expect(host.textContent).toContain("Deine Bewertung ist eingegangen und abgeschlossen.");
  expect(host.querySelector("form")).toBeNull(); expect(updateReview).not.toHaveBeenCalled();
});
it("keeps edits and the link usable when saving fails", async () => {
  await act(async () => root.render(createElement(ReviewForm)));
  updateReviewRating.mockRejectedValueOnce(new Error("offline"));
  const star = host.querySelector<HTMLInputElement>('input[name="overallRating"][value="4"]')!;
  await act(async () => star.click());
  expect(host.textContent).toContain("Speichern fehlgeschlagen");
  expect(host.querySelector<HTMLInputElement>('input[name="overallRating"]:checked')?.value).toBe("4");
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  await act(async () => star.click());
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
});
