import { getBrandIconColor } from "@/lib/environment";

export const dynamic = "force-dynamic";

export function GET() {
  return new Response(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="${getBrandIconColor()}"/>
  <g transform="translate(14 14) scale(1.5)" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="5" width="18" height="16" rx="2"/>
    <path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2"/>
  </g>
</svg>`, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" } });
}
