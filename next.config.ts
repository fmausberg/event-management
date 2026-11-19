import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["exceljs", "csv-parse"],
  outputFileTracingIncludes: {
    "/company/*/bookings/import": ["./node_modules/exceljs/**/*", "./node_modules/csv-parse/**/*"],
  },
  output: "standalone",
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
  async redirects() {
    return [{ source: "/impressum", destination: "https://event-yoga.com/impressum/", permanent: true }];
  },
  async headers() {
    return ["/tickets", "/booking/manage", "/booking/payment/:path*", "/company/:companyKey/bookings/import", "/company/:companyKey/bookings/imports/:path*"].map((source) => ({ source, headers: [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
      { key: "Cache-Control", value: "private, no-store" },
      { key: "X-Frame-Options", value: "DENY" },
    ] }));
  },
  distDir: process.env.NEXT_BUILD_DIR || ".next",
};

export default nextConfig;
