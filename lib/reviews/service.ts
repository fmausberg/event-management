import "server-only";
import { getPrisma } from "@/lib/db/prisma";
import { hashReviewToken } from "./token";
import { rating, reviewInput, reviewToken } from "./validation";

const include = { event: { select: { name: true, beginsAt: true, endsAt: true, status: true, trainerName: true, trainers: { select: { trainerId: true } } } }, ticket: { select: { checkedInAt: true } } } as const;
async function findReview(db: Pick<ReturnType<typeof getPrisma>, "eventReview" | "eventReviewResendToken">, tokenHash: string) {
  const original = await db.eventReview.findUnique({ where: { tokenHash }, include });
  if (original) return original;
  const resend = await db.eventReviewResendToken.findUnique({ where: { tokenHash }, include: { review: { include } } });
  return resend?.review ?? null;
}
const eligible = (entry: { expiresAt: Date; event: { endsAt: Date | null; status: string }; ticket: { checkedInAt: Date | null } }, now: Date) =>
  entry.expiresAt > now && !!entry.event.endsAt && entry.event.endsAt <= now && ["PUBLISHED", "COMPLETED"].includes(entry.event.status) && !!entry.ticket.checkedInAt;

/** Read-only lookup; the client separately POSTs the selected mail rating. */
export async function readReview(token: unknown) {
  if (!reviewToken.safeParse(token).success) return { state: "invalid" as const };
  const entry = await findReview(getPrisma(), hashReviewToken(token as string));
  if (!entry) return { state: "invalid" as const };
  if (entry.status === "COMPLETED") return { state: "completed" as const };
  if (!eligible(entry, new Date())) return { state: "invalid" as const };
  return { state: "open" as const, eventName: entry.event.name, date: entry.event.beginsAt?.toISOString() ?? null,
    hasTrainer: !!entry.event.trainerName || entry.event.trainers.length > 0,
    overallRating: entry.overallRating, trainerRating: entry.trainerRating, locationRating: entry.locationRating, organizationRating: entry.organizationRating,
    overallComment: entry.overallComment, trainerComment: entry.trainerComment, locationComment: entry.locationComment, organizationComment: entry.organizationComment,
  };
}

export async function saveReview(token: unknown, input: unknown, finalize: boolean) {
  const parsed = reviewInput.safeParse(input);
  if (!reviewToken.safeParse(token).success || !parsed.success || typeof finalize !== "boolean") return { state: "error" as const, message: "Bitte wähle 1 bis 5 Sterne und höchstens 2000 Zeichen je Kommentar." };
  const tokenHash = hashReviewToken(token as string);
  return getPrisma().$transaction(async tx => {
    const now = new Date();
    const entry = await findReview(tx, tokenHash);
    if (entry?.status === "COMPLETED") return { state: "completed" as const };
    if (!entry || !eligible(entry, now)) return { state: "invalid" as const };
    const { overallComment, trainerComment, locationComment, organizationComment, ...ratings } = parsed.data;
    if (finalize && !entry.overallRating) return { state: "error" as const, message: "Bitte speichere zuerst eine Gesamtbewertung." };
    const data = finalize ? { overallComment, trainerComment, locationComment, organizationComment } : ratings;
    if (!entry.event.trainerName && !entry.event.trainers.length) {
      if ("trainerRating" in data) data.trainerRating = null;
      if ("trainerComment" in data) data.trainerComment = null;
    }
    // The conditional write serializes competing saves/submits: a final row is immutable.
    const updated = await tx.eventReview.updateMany({ where: { tokenHash: entry.tokenHash, status: "PROVISIONAL", submittedAt: null, expiresAt: { gt: now } },
      data: { ...data, ...(finalize ? { status: "COMPLETED", submittedAt: now } : {}) } });
    return { state: !updated.count || finalize ? "completed" as const : "saved" as const };
  });
}

/** A star changes only its own field, preserving other ratings and draft comments. */
export async function saveReviewRating(token: unknown, field: unknown, value: unknown) {
  if (!reviewToken.safeParse(token).success || typeof field !== "string" || !["overallRating", "trainerRating", "locationRating", "organizationRating"].includes(field)
    || !(value === null && field !== "overallRating") && !rating.safeParse(value).success) {
    return { state: "error" as const, message: "Bitte wähle 1 bis 5 Sterne." };
  }
  return getPrisma().$transaction(async tx => {
    const entry = await findReview(tx, hashReviewToken(token as string));
    if (entry?.status === "COMPLETED") return { state: "completed" as const };
    const now = new Date();
    if (!entry || !eligible(entry, now)) return { state: "invalid" as const };
    if (field === "trainerRating" && !entry.event.trainerName && !entry.event.trainers.length) return { state: "error" as const, message: "Für dieses Event ist keine Trainerbewertung vorgesehen." };
    const updated = await tx.eventReview.updateMany({ where: { tokenHash: entry.tokenHash, status: "PROVISIONAL", submittedAt: null, expiresAt: { gt: now } }, data: { [field]: value as number | null } });
    return { state: updated.count ? "saved" as const : "completed" as const };
  });
}
