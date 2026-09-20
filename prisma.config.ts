import { defineConfig } from "prisma/config";
import { loadEnvFile } from "node:process";

try {
  loadEnvFile(".env");
} catch {
  // .env.local not present — fall back to process.env
}

// DigitalOcean (and other managed DBs) may include sslrootcert/sslcert params
// pointing to local cert files that don't exist on dev machines.
// Strip those and ensure sslmode=require so Prisma CLI can connect.
function buildMigrateUrl(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  const url = new URL(raw);
  url.searchParams.delete("sslrootcert");
  url.searchParams.delete("sslcert");
  url.searchParams.delete("sslkey");
  if (!url.searchParams.has("sslmode")) {
    url.searchParams.set("sslmode", "require");
  }
  return url.toString();
}

export default defineConfig({
  datasource: {
    url: buildMigrateUrl(process.env.DATABASE_URL),
  },
});
