import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [{ source: "/tickets", headers: [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
      { key: "Cache-Control", value: "private, no-store" },
      { key: "X-Frame-Options", value: "DENY" },
    ] }];
  },
  distDir: process.env.NEXT_BUILD_DIR || ".next",
};

export default nextConfig;
