import { expect, it, vi } from "vitest";
import { safeReturnTo } from "@/lib/auth/return-to";
import { NextRequest } from "next/server";
vi.mock("@/auth", () => ({ auth: async (handler: unknown) => handler }));
import { proxy } from "@/proxy";

it.each(["https://evil.example", "//evil.example", "/\\evil.example", "/%2fevil.example", "/%5cevil.example", "/login", "/api/auth/signout", null])("rejects unsafe destinations: %s", (value) => {
  expect(safeReturnTo(value)).toBe("/account");
});
it("preserves internal paths and query parameters", () => {
  expect(safeReturnTo("/company/yoga/events/event-1/tickets?q=123")).toBe("/company/yoga/events/event-1/tickets?q=123");
});
it("remembers the protected page before redirecting a guest to login", async () => {
  const request = new NextRequest("https://events.example/account/events?filter=trainer");
  Object.assign(request, { auth: null });
  const response = await (proxy as unknown as (request: NextRequest) => Promise<Response>)(request);
  const target = new URL(response.headers.get("location")!);
  expect(target.pathname).toBe("/login");
  expect(target.searchParams.get("returnTo")).toBe("/account/events?filter=trainer");
});
it("leaves authenticated page access to the existing authorization checks", async () => {
  const request = new NextRequest("https://events.example/account/events");
  Object.assign(request, { auth: { user: { id: "user-1" } } });
  const response = await (proxy as unknown as (request: NextRequest) => Promise<Response>)(request);
  expect(response.headers.get("location")).toBeNull();
});
