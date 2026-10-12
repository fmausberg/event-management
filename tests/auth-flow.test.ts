import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hash as bcryptHash } from "bcryptjs";
import { handlers } from "@/auth";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { loginSchema, registerSchema } from "@/lib/auth/validation";

const { db } = vi.hoisted(() => ({ db: {
  user: { findMany: vi.fn(), findUnique: vi.fn() },
  authRateLimit: { deleteMany: vi.fn(), upsert: vi.fn() },
} }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));

const password = "Eine lange Passphrase!";
let passwordHash: string;
beforeAll(async () => { passwordHash = await hashPassword(password); });
beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "test-only-secret-with-at-least-thirty-two-characters");
  vi.stubEnv("AUTH_URL", "https://events.example.test");
  for (const key of ["AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET", "AUTH_GITHUB_ID", "AUTH_GITHUB_SECRET"]) vi.stubEnv(key, "");
  db.user.findMany.mockResolvedValue([{ id: "user-1", name: "Ada", email: "ada@example.com", image: null, passwordHash }]);
  db.user.findUnique.mockResolvedValue({ id: "user-1" });
  db.authRateLimit.deleteMany.mockResolvedValue({ count: 0 });
  db.authRateLimit.upsert.mockResolvedValue({ attempts: 1 });
});
afterEach(() => vi.unstubAllEnvs());

function request(path: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`https://events.example.test/api/auth/${path}`, init);
}
function cookieHeader(response: Response) {
  return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
}
async function login(input: Record<string, string> = {}) {
  const csrf = await handlers.GET(request("csrf"));
  const { csrfToken } = await csrf.json();
  return handlers.POST(request("callback/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", cookie: cookieHeader(csrf) },
    body: new URLSearchParams({ csrfToken, email: "  ADA@Example.com  ", password, callbackUrl: "/account", ...input }).toString(),
  }));
}

describe("credentials HTTP flow with real Auth.js and password hashing (database double)", () => {
  it("creates a secure session, exposes only public user fields, and signs out", async () => {
    const response = await login();
    expect(response.headers.get("location")).toBe("https://events.example.test/account");
    const sessionCookie = response.headers.getSetCookie().find((cookie) => cookie.startsWith("__Secure-authjs.session-token="));
    expect(sessionCookie).toContain("HttpOnly");
    expect(sessionCookie).toContain("Secure");
    expect(sessionCookie).toContain("SameSite=Lax");
    expect(sessionCookie).not.toContain(passwordHash);
    expect(db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { email: { equals: "ada@example.com", mode: "insensitive" } },
    }));
    const cookie = cookieHeader(response);
    const sessionResponse = await handlers.GET(request("session", { headers: { cookie } }));
    const session = await sessionResponse.json();
    expect(session.user).toEqual({ id: "user-1", name: "Ada", email: "ada@example.com", image: null });
    expect(JSON.stringify(session)).not.toContain("password");
    expect(new Date(session.expires).getTime() - Date.now()).toBeLessThanOrEqual(8 * 60 * 60 * 1000);
    const csrf = await handlers.GET(request("csrf", { headers: { cookie } }));
    const { csrfToken } = await csrf.json();
    const logout = await handlers.POST(request("signout", {
      method: "POST", headers: { cookie: `${cookie}; ${cookieHeader(csrf)}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken }).toString(),
    }));
    expect(logout.headers.getSetCookie().some((value) => value.startsWith("__Secure-authjs.session-token=;") && value.includes("Max-Age=0"))).toBe(true);
  });

  it.each(["wrong-password", "unknown-user", "oauth-only"])("rejects %s without revealing whether the account exists", async (scenario) => {
    if (scenario === "unknown-user") db.user.findMany.mockResolvedValue([]);
    if (scenario === "oauth-only") db.user.findMany.mockResolvedValue([{ id: "user-1", passwordHash: null }]);
    const response = await login(scenario === "wrong-password" ? { password: "wrong" } : {});
    expect(response.headers.get("location")).toContain("error=CredentialsSignin&code=credentials");
    expect(cookieHeader(response)).not.toContain("session-token");
  });

  it("denies attempts over the shared rate limit before checking passwords", async () => {
    db.authRateLimit.upsert.mockResolvedValue({ attempts: 11 });
    const response = await login();
    expect(response.headers.get("location")).toContain("code=rate_limited");
    expect(db.user.findMany).not.toHaveBeenCalled();
  });
  it.each(["a", "😀".repeat(1000)])("accepts short and long passwords through the login endpoint", async (value) => {
    const storedHash = await hashPassword(value);
    db.user.findMany.mockResolvedValue([{ id: "user-1", name: "Ada", email: "ada@example.com", image: null, passwordHash: storedHash }]);
    const response = await login({ password: value });
    expect(response.headers.get("location")).toBe("https://events.example.test/account");
    expect(cookieHeader(response)).toContain("session-token");
  });

  it("rejects login without CSRF and refuses external callback destinations", async () => {
    const missingCsrf = await handlers.POST(request("callback/credentials", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email: "ada@example.com", password }).toString(),
    }));
    expect(missingCsrf.headers.get("location")).toContain("MissingCSRF");
    expect(db.user.findMany).not.toHaveBeenCalled();
    const response = await login({ callbackUrl: "https://evil.example/steal" });
    expect(response.headers.get("location")).toBe("https://events.example.test");
  });

  it("invalidates a session when its user has been deleted", async () => {
    const response = await login();
    db.user.findUnique.mockResolvedValue(null);
    const sessionResponse = await handlers.GET(request("session", { headers: { cookie: cookieHeader(response) } }));
    expect(await sessionResponse.json()).toBeNull();
  });

  it("only enables OAuth with complete configuration", async () => {
    vi.stubEnv("AUTH_GOOGLE_ID", "example-google-client");
    let response = await handlers.GET(request("providers"));
    expect(Object.keys(await response.json())).toEqual(["credentials"]);
    vi.stubEnv("AUTH_GOOGLE_SECRET", "example-google-secret");
    vi.stubEnv("AUTH_GITHUB_ID", "example-github-client");
    vi.stubEnv("AUTH_GITHUB_SECRET", "example-github-secret");
    response = await handlers.GET(request("providers"));
    expect(Object.keys(await response.json())).toEqual(["google", "github", "credentials"]);
  });
});

describe("password and validation boundaries", () => {
  it("uses salted hashes and does not trim passwords", async () => {
    const otherHash = await hashPassword(password);
    expect(otherHash).not.toBe(passwordHash);
    expect(passwordHash).not.toContain(password);
    expect(await verifyPassword(password, passwordHash)).toBe(true);
    expect(await verifyPassword(` ${password}`, passwordHash)).toBe(false);
    expect(await verifyPassword(password, null)).toBe(false);
  });

  it("supports existing bcrypt hashes without accepting truncated suffixes", async () => {
    const legacyPassword = "a".repeat(72);
    const legacyHash = await bcryptHash(legacyPassword, 12);
    expect(await verifyPassword(legacyPassword, legacyHash)).toBe(true);
    expect(await verifyPassword("wrong", legacyHash)).toBe(false);
    expect(await verifyPassword(`${legacyPassword}extra`, legacyHash)).toBe(false);
  });

  it("uses the entire long password, including Unicode, whitespace and null bytes", async () => {
    const longPassword = ` ${"😀".repeat(1000)}\0end `;
    const stored = await hashPassword(longPassword);
    expect(await verifyPassword(longPassword, stored)).toBe(true);
    expect(await verifyPassword(`${longPassword}different`, stored)).toBe(false);
    expect(await verifyPassword(longPassword.trim(), stored)).toBe(false);
    expect(await verifyPassword(longPassword.split("\0")[0], stored)).toBe(false);
  });

  it.each(["", "invalid", "scrypt-v1$00$00"])("fails closed for malformed stored hashes", async (stored) => {
    expect(await verifyPassword(password, stored)).toBe(false);
  });

  it("normalizes email, rejects missing input and mismatches, and accepts arbitrary password lengths", () => {
    expect(loginSchema.parse({ email: " ADA@Example.com ", password }).email).toBe("ada@example.com");
    expect(loginSchema.safeParse({ email: "not-an-email", password }).success).toBe(false);
    expect(loginSchema.safeParse({ email: ["ada@example.com"], password }).success).toBe(false);
    const data = { name: "Ada", email: "ada@example.com", password, confirmPassword: password };
    expect(registerSchema.safeParse(data).success).toBe(true);
    expect(registerSchema.safeParse({ ...data, confirmPassword: "other" }).success).toBe(false);
    for (const value of ["a", " ", "😀".repeat(1000), "a".repeat(10000)]) {
      expect(registerSchema.safeParse({ ...data, password: value, confirmPassword: value }).success).toBe(true);
      expect(loginSchema.safeParse({ email: data.email, password: value }).success).toBe(true);
    }
    expect(registerSchema.safeParse({ ...data, password: "", confirmPassword: "" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: data.email, password: null }).success).toBe(false);
  });
});
