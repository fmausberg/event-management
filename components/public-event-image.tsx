"use client";
import { useState } from "react";
import { eventImageDelivery } from "@/lib/events/image-delivery";

export function PublicEventImage({ imageUrl, variant = "card", eager = false }: { imageUrl?: string | null; variant?: "card" | "detail"; eager?: boolean }) {
  const [failed, setFailed] = useState(false);
  const url = imageUrl;
  const valid = url && /^https?:\/\//i.test(url);
  if (variant === "detail" && !valid) return null;
  return <div className={`relative aspect-[16/9] overflow-hidden bg-primary-50 ${variant === "detail" ? "mb-6 rounded-xl" : ""}`}>
    {valid && !failed ? /* Cloudinary handles delivery optimization without a server-side proxy. */
      // eslint-disable-next-line @next/next/no-img-element
      <img {...eventImageDelivery(url, variant)} width={1600} height={900} alt="" loading={eager ? "eager" : "lazy"} referrerPolicy="no-referrer" onError={() => setFailed(true)} className={`h-full w-full object-cover ${variant === "card" ? "transition-transform duration-300 group-hover:scale-105" : ""}`} /> : <div className="flex h-full items-center justify-center bg-gradient-to-br from-primary-100 via-primary-50 to-amber-50"><svg aria-hidden="true" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="text-primary-600/50"><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 11h18m-14 4h3m4 0h3m-10 3h3" /></svg></div>}
  </div>;
}
