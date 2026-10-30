"use server";
import { readReview, saveReview, saveReviewRating } from "@/lib/reviews/service";
export async function loadReview(token: unknown) {
  return readReview(token);
}
export async function updateReviewRating(token: unknown, field: unknown, value: unknown) {
  return saveReviewRating(token, field, value);
}
export async function updateReview(token: unknown, input: unknown, finalize: boolean) {
  return saveReview(token, input, finalize);
}
