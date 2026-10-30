export type RatingSummary = { average: number | null; count: number };

export function ratingSummary(sum: number, count: number): RatingSummary {
  return { count, average: count > 0 ? sum / count : null };
}

export function ratingSummaryLabels({ average, count }: RatingSummary) {
  if (!count || average === null) return { score: "Noch keine Bewertungen", answers: null };
  return {
    score: `${average.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ★`,
    answers: `(${count} ${count === 1 ? "Bewertung" : "Bewertungen"})`,
  };
}

export function formatRatingSummary(rating: RatingSummary) {
  const { score, answers } = ratingSummaryLabels(rating);
  return answers ? `${score} ${answers}` : score;
}
