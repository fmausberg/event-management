<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with the work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project-specific working conventions

- Keep the interface consistent with the existing application. Before changing UI, inspect nearby pages and shared components and follow their established layout, spacing, typography, colors, controls, and interaction patterns. Prefer extending shared components over introducing a parallel visual style.
- Do not run the full test suite, lint, type checks, or build by default. Run these checks only when the user explicitly asks for them. If a task explicitly asks for verification, clarify which checks are requested from the wording and keep them scoped to the change.
- When adding a Prisma migration, use the existing timestamped directory convention: `YYYYMMDDHHMMSS_descriptive_name` (for example, `20261030170000_trainer_reminder_multiple_requests`). Do not rename or rewrite migrations that have already been applied or committed. Describe any required migration and deployment steps to the user.
- Do not create or apply a production migration unless the requested task requires a schema change. Follow the repository's existing Prisma migration workflow and never use `migrate dev` or `db push` against production.

