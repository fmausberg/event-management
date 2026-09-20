import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Preserve shell variables; otherwise prefer .env.local over .env.
config({ path: [".env.local", ".env"], quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    // Use the configured URL unchanged, including its TLS settings.
    // Generation works without a URL; database commands require one.
    url: process.env.DATABASE_URL,
  },
});
