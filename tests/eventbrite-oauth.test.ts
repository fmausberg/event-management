import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { digest, pending, sessionBinding } from "@/lib/eventbrite/connection";
import { GET } from "@/app/api/integrations/eventbrite/callback/route";

const { auth, db, admin } = vi.hoisted(() => ({
  auth: vi.fn(), admin: vi.fn(),
  db: { eventbriteOAuth: { findUnique: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() } },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("@/lib/companies/members", () => ({ requireCompanyAdmin: admin }));

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

beforeEach(() => {
  vi.stubEnv("AUTH_URL", "https://events.example.test");
  vi.stubEnv("EVENTBRITE_REDIRECT_URI", "https://events.example.test/api/integrations/eventbrite/callback");
  vi.stubEnv("EVENTBRITE_CLIENT_ID", "test-client");
  vi.stubEnv("EVENTBRITE_CLIENT_SECRET", "test-secret");
  vi.stubEnv("EVENTBRITE_TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 1).toString("base64"));
  auth.mockResolvedValue({ user: { id: "admin" }, loginSessionId: "login-one" });
  admin.mockResolvedValue({ id: "company", slug: "example" });
  db.eventbriteOAuth.updateMany.mockResolvedValue({ count: 1 });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function flow(overrides = {}) {
  return { id: "attempt", companyId: "company", company: { slug: "example" }, userId: "admin",
    sessionHash: digest("login-one"), stateHash: digest("a".repeat(43)),
    expiresAt: new Date(Date.now() + 60_000), encryptedAccessToken: null, ...overrides };
}
function callback() {
  return GET(new Request(`https://events.example.test/api/integrations/eventbrite/callback?state=${"a".repeat(43)}&code=test-code`,
    { headers: { host: "events.example.test", "x-forwarded-host": "events.example.test", "x-forwarded-proto": "https" } }));
}

it("saves the callback for the same login and retrieves it after redirect without creating a connection", async () => {
  const attempt = flow();
  db.eventbriteOAuth.findFirst.mockResolvedValue(attempt);
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ access_token: "test-token" }))
    .mockResolvedValueOnce(Response.json({ organizations: [{ id: "123", name: "Example" }], pagination: { has_more_items: false } }));
  vi.stubGlobal("fetch", fetch);
  const response = await callback();
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("https://events.example.test/company/example/settings?eventbrite=pending");
  const saved = db.eventbriteOAuth.updateMany.mock.calls[1][0];
  expect(saved.where).toMatchObject({ companyId: "company", userId: "admin", sessionHash: digest("login-one"), stateHash: null });
  expect(saved.data.encryptedAccessToken).not.toContain("test-token");
  db.eventbriteOAuth.findUnique.mockResolvedValue({ ...attempt, ...saved.data, stateHash: null });
  expect((await pending("company"))?.encryptedAccessToken).toBe(saved.data.encryptedAccessToken);
  expect(console.info).toHaveBeenCalledWith("[eventbrite:callback] pending saved", { stage: "pending-save", organizationCount: 1 });
});

it("rejects another login of the same user before token exchange and redirects with an error", async () => {
  db.eventbriteOAuth.findFirst.mockResolvedValue(flow({ sessionHash: digest("other-login") }));
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const response = await callback();
  expect(response.headers.get("location")).toContain("?error=session");
  expect(fetch).not.toHaveBeenCalled();
  expect(db.eventbriteOAuth.updateMany).not.toHaveBeenCalled();
});

it.each([
  [{ sessionHash: digest("other-login") }, "session"],
  [{ userId: "another-admin" }, "session"],
  [{ expiresAt: new Date(0) }, "expired"],
])("reports inaccessible pending attempts instead of returning null: %s", async (overrides, reason) => {
  db.eventbriteOAuth.findUnique.mockResolvedValue(flow(overrides));
  await expect(pending("company")).rejects.toMatchObject({ reason });
});

it("requires re-login for legacy sessions without a login identifier", async () => {
  auth.mockResolvedValue({ user: { id: "admin" } });
  await expect(sessionBinding()).rejects.toMatchObject({ reason: "session" });
});

it("rejects expired callbacks and failed atomic claims before token exchange", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  db.eventbriteOAuth.findFirst.mockResolvedValue(flow({ expiresAt: new Date(0) }));
  expect((await callback()).headers.get("location")).toContain("?error=expired");
  db.eventbriteOAuth.findFirst.mockResolvedValue(flow());
  db.eventbriteOAuth.updateMany.mockResolvedValue({ count: 0 });
  expect((await callback()).headers.get("location")).toContain("?error=expired");
  expect(fetch).not.toHaveBeenCalled();
});

it("cleans up a consumed flow and reports the failing provider phase", async () => {
  db.eventbriteOAuth.findFirst.mockResolvedValue(flow());
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
  expect((await callback()).headers.get("location")).toContain("?error=provider");
  expect(db.eventbriteOAuth.deleteMany).toHaveBeenCalledWith({ where: { id: "attempt" } });
  expect(console.error).toHaveBeenCalledWith("[eventbrite:callback] rejected", { stage: "token-exchange", reason: "provider" });
});
