import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { CredentialsSignin } from "next-auth";
import { verifyPassword } from "@/lib/auth/password";
import { login, register, oauthLogin, logout } from "@/app/(auth)/actions";

const { db, signIn, signOut, redirect } = vi.hoisted(() => ({
  db: { user: { findMany: vi.fn(), create: vi.fn() }, authRateLimit: { deleteMany: vi.fn(), upsert: vi.fn() } },
  signIn: vi.fn(), signOut: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`REDIRECT:${path}`); }),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("@/auth", () => ({ signIn, signOut }));
vi.mock("next/navigation", () => ({ redirect }));

const password = "Eine lange Passphrase!";
function form(overrides: Record<string, string> = {}) {
  const data = new FormData();
  Object.entries({ name: " Ada ", email: " ADA@Example.com ", password, confirmPassword: password, role: "ADMIN", ...overrides })
    .forEach(([key, value]) => data.set(key, value));
  return data;
}
beforeEach(() => {
  db.user.findMany.mockResolvedValue([]);
  db.user.create.mockResolvedValue({ id: "user-1" });
  db.authRateLimit.deleteMany.mockResolvedValue({ count: 0 });
  db.authRateLimit.upsert.mockResolvedValue({ attempts: 1 });
  signIn.mockResolvedValue("/account");
});
afterEach(() => vi.unstubAllEnvs());

describe("registration", () => {
  it("persists normalized identity and a verifiable hash, ignores submitted roles, then redirects", async () => {
    await expect(register({}, form())).rejects.toThrow("REDIRECT:/login?registered=1");
    const saved = db.user.create.mock.calls[0][0].data;
    expect(Object.keys(saved).sort()).toEqual(["email", "name", "passwordHash"]);
    expect(saved.email).toBe("ada@example.com");
    expect(saved.name).toBe("Ada");
    expect(saved.passwordHash).not.toBe(password);
    expect(await verifyPassword(password, saved.passwordHash)).toBe(true);
  });
  it("rejects invalid fields before database calls and never echoes passwords", async () => {
    const result = await register({}, form({ confirmPassword: "mismatch" }));
    expect(result.errors?.confirmPassword).toBeTruthy();
    expect(db.authRateLimit.upsert).not.toHaveBeenCalled();
    expect(db.user.create).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(password);
  });
  it.each(["a", "😀".repeat(1000)])("registers and verifies passwords without length or complexity restrictions", async (value) => {
    await expect(register({}, form({ password: value, confirmPassword: value }))).rejects.toThrow("REDIRECT:/login?registered=1");
    const saved = db.user.create.mock.calls[0][0].data;
    expect(await verifyPassword(value, saved.passwordHash)).toBe(true);
    expect(await verifyPassword(`${value}x`, saved.passwordHash)).toBe(false);
  });
  it("rejects existing mixed-case and ambiguous legacy addresses", async () => {
    db.user.findMany.mockResolvedValueOnce([{ id: "old", email: "ADA@example.com" }]);
    expect((await register({}, form())).message).toContain("kein neues Konto");
    db.user.findMany.mockResolvedValueOnce([{ id: "old" }, { id: "other" }]);
    expect((await register({}, form())).message).toContain("gerade nicht möglich");
    expect(db.user.create).not.toHaveBeenCalled();
  });
  it("handles concurrent duplicate inserts and hides database details", async () => {
    db.user.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("private detail", { code: "P2002", clientVersion: "7.10.0" }));
    expect((await register({}, form())).message).toContain("kein neues Konto");
    db.user.create.mockRejectedValueOnce(new Error("secret database connection"));
    const result = await register({}, form());
    expect(result.message).toContain("gerade nicht möglich");
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("limits registrations before creating a user", async () => {
    db.authRateLimit.upsert.mockResolvedValue({ attempts: 6 });
    expect((await register({}, form())).message).toContain("15 Minuten");
    expect(db.user.create).not.toHaveBeenCalled();
  });
});

describe("login actions", () => {
  it("normalizes credentials, supplies a fixed destination, and redirects after authentication", async () => {
    await expect(login({}, form({ callbackUrl: "https://evil.example" }))).rejects.toThrow("REDIRECT:/account");
    expect(signIn).toHaveBeenCalledWith("credentials", { email: "ada@example.com", password, redirect: false, redirectTo: "/account" });
  });
  it("returns understandable credential, throttling, and infrastructure errors", async () => {
    signIn.mockRejectedValueOnce(new CredentialsSignin());
    expect((await login({}, form())).message).toBe("E-Mail-Adresse oder Passwort ist falsch.");
    const limited = new CredentialsSignin(); limited.code = "rate_limited";
    signIn.mockRejectedValueOnce(limited);
    expect((await login({}, form())).message).toContain("15 Minuten");
    signIn.mockRejectedValueOnce(new Error("DATABASE_URL contains secret"));
    const result = await login({}, form());
    expect(result.message).toContain("gerade nicht möglich");
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("only starts configured OAuth providers", async () => {
    vi.stubEnv("AUTH_GOOGLE_ID", "");
    vi.stubEnv("AUTH_GOOGLE_SECRET", "");
    await expect(oauthLogin(form({ provider: "google" }))).rejects.toThrow("REDIRECT:/login?error=Configuration");
    expect(signIn).not.toHaveBeenCalled();
    vi.stubEnv("AUTH_GOOGLE_ID", "client-id");
    vi.stubEnv("AUTH_GOOGLE_SECRET", "client-secret");
    signIn.mockResolvedValue("https://accounts.google.com/example");
    await expect(oauthLogin(form({ provider: "google" }))).rejects.toThrow("REDIRECT:https://accounts.google.com/example");
    expect(signIn).toHaveBeenCalledWith("google", { redirect: false, redirectTo: "/account" });
  });
  it("signs out through the server action", async () => {
    await logout();
    expect(signOut).toHaveBeenCalledWith({ redirectTo: "/login" });
  });
});
