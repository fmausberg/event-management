import type { Metadata } from "next";
import { ReviewForm } from "./review-form";
export const metadata: Metadata = { title: "Event bewerten", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default function ReviewPage() {
  return <main className="mx-auto w-full max-w-xl flex-1 px-5 py-10"><ReviewForm /></main>;
}
