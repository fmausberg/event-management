import { ratingSummaryLabels, type RatingSummary as Summary } from "@/lib/reviews/summary";

export function RatingSummary({ rating }: { rating: Summary }) {
  const { score, answers } = ratingSummaryLabels(rating);
  return <span className="block min-w-40 max-w-64 text-sm leading-relaxed">{score}{answers && <> <span className="text-zinc-500 dark:text-zinc-400">{answers}</span></>}</span>;
}
