import { z } from "zod";

export const rating = z.number().int().min(1).max(5);
const comment = z.string().trim().max(2000).nullable().optional().transform(value => value || null);
export const reviewInput = z.object({
  overallRating: rating,
  trainerRating: rating.nullable().optional().transform(value => value ?? null),
  locationRating: rating.nullable().optional().transform(value => value ?? null),
  organizationRating: rating.nullable().optional().transform(value => value ?? null),
  overallComment: comment,
  trainerComment: comment,
  locationComment: comment,
  organizationComment: comment,
});
export const reviewToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const REVIEW_LIFETIME_MS = 30 * 24 * 60 * 60_000;
