import { beforeEach, expect, it, vi } from "vitest";
import type { NextAuthConfig } from "next-auth";
import "@/auth";

const { state, recordLoginAudit, findUnique, count } = vi.hoisted(() => ({
  state: { factory: undefined as (() => NextAuthConfig) | undefined },
  recordLoginAudit: vi.fn(), findUnique: vi.fn(), count: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({
  default: (factory: () => NextAuthConfig) => { state.factory = factory; return {}; },
  CredentialsSignin: class extends Error {},
}));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => ({ user: { findUnique, count } }), recordLoginAudit }));

beforeEach(() => {
  recordLoginAudit.mockReset();
  findUnique.mockResolvedValue({ emailVerified: new Date() });
  count.mockResolvedValue(0);
});

async function signIn(provider: string, userId = "user-1") {
  const config = state.factory!();
  await config.events!.signIn!({ user: { id: userId, email: "ada@example.com" }, account: { provider, type: provider === "credentials" ? "credentials" : "oauth", providerAccountId: userId } });
}

it.each([["credentials", "password"], ["google", "google"], ["github", "github"]])("records verified sign-ins via %s", async (provider, method) => {
  await signIn(provider);
  expect(recordLoginAudit).toHaveBeenCalledExactlyOnceWith("user-1", method);
});

it("does not record OAuth identities rejected for missing email verification", async () => {
  findUnique.mockResolvedValue({ emailVerified: null });
  await signIn("google");
  expect(recordLoginAudit).not.toHaveBeenCalled();
});

it("records recovery sign-ins only while no platform admin exists", async () => {
  await signIn("credentials", "__recovery_admin__");
  expect(recordLoginAudit).toHaveBeenCalledExactlyOnceWith("__recovery_admin__", "recovery");
  recordLoginAudit.mockClear();
  count.mockResolvedValue(1);
  await signIn("credentials", "__recovery_admin__");
  expect(recordLoginAudit).not.toHaveBeenCalled();
});

it("does not forward provider payloads or unknown methods to the audit writer", async () => {
  await signIn("unexpected-provider");
  expect(recordLoginAudit).not.toHaveBeenCalled();
});
