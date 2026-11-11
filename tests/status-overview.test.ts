import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/prisma", () => ({ getPrisma: vi.fn() }));
vi.mock("@/lib/mail", () => ({ verifyMailConnection: vi.fn() }));
vi.mock("@/lib/eventbrite/connection", () => ({ configuration: vi.fn() }));
import { probe } from "@/lib/status/overview";

afterEach(() => vi.useRealTimers());

it("does not contact unconfigured services", async () => {
  const check = vi.fn();
  expect((await probe("DB", false, "ok", check)).state).toBe("unconfigured");
  expect(check).not.toHaveBeenCalled();
});
it("accepts zero users as a successful read without exposing the result", async () => {
  expect(await probe("DB", true, "Read successful", async () => 0)).toMatchObject({ state: "healthy", detail: "Read successful" });
});
it.each([401, 403])("classifies access failures without exposing provider errors (%s)", async statusCode => {
  const result = await probe("Stripe", true, "ok", async () => { throw { statusCode, message: "secret-key" }; });
  expect(result.state).toBe("denied");
  expect(JSON.stringify(result)).not.toContain("secret-key");
});
it("returns an unknown state after the deadline even if the provider hangs", async () => {
  vi.useFakeTimers();
  const result = probe("DB", true, "ok", () => new Promise(() => {}));
  await vi.advanceTimersByTimeAsync(8_000);
  expect((await result).state).toBe("timeout");
});
it("marks successful but slow checks as degraded", async () => {
  vi.useFakeTimers();
  const result = probe("DB", true, "ok", () => new Promise(resolve => setTimeout(resolve, 2_100)));
  await vi.advanceTimersByTimeAsync(2_100);
  expect((await result).state).toBe("slow");
});
it("isolates a failing provider from successful checks", async () => {
  const results = await Promise.all([
    probe("DB", true, "ok", async () => { throw new Error("private"); }),
    probe("Stripe", true, "ok", async () => ({})),
  ]);
  expect(results.map(result => result.state)).toEqual(["error", "healthy"]);
});
