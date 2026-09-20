import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { createClient, createAdapter } = vi.hoisted(() => ({ createClient: vi.fn(), createAdapter: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@prisma/client", () => ({ PrismaClient: class { constructor() { createClient(); } } }));
vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: class { constructor(options: unknown) { createAdapter(options); } } }));

const globals = globalThis as unknown as { prisma?: unknown };
beforeEach(() => {
  delete globals.prisma;
  vi.resetModules();
  vi.stubEnv("NODE_ENV", "development");
});
afterEach(() => { delete globals.prisma; vi.unstubAllEnvs(); });

it("constructs lazily and reuses the development client across module reloads", async () => {
  vi.stubEnv("DATABASE_URL", "postgresql://localhost/example");
  const firstModule = await import("@/lib/db/prisma");
  expect(createClient).not.toHaveBeenCalled();
  const firstClient = firstModule.getPrisma();
  expect(firstModule.getPrisma()).toBe(firstClient);
  vi.resetModules();
  const secondModule = await import("@/lib/db/prisma");
  expect(secondModule.getPrisma()).toBe(firstClient);
  expect(createClient).toHaveBeenCalledTimes(1);
  expect(createAdapter).toHaveBeenCalledWith({ connectionString: "postgresql://localhost/example" });
});

it("requires DATABASE_URL only when accessing the client", async () => {
  vi.stubEnv("DATABASE_URL", "");
  const { getPrisma } = await import("@/lib/db/prisma");
  expect(() => getPrisma()).toThrow("DATABASE_URL is required");
  expect(createClient).not.toHaveBeenCalled();
});
