import { afterEach, expect, it, vi } from "vitest";
import { getBrandIconColor } from "@/lib/environment";
import { GET } from "@/app/icon.svg/route";

vi.mock("server-only", () => ({}));
afterEach(() => vi.unstubAllEnvs());

it.each([
  ["", "development", "#f97316"],
  ["", "production", "#007c80"],
  ["test", "production", "#f97316"],
  ["staging", "production", "#f97316"],
  ["production", "production", "#007c80"],
])("uses APP_ENV=%s with NODE_ENV=%s consistently for the logo and favicon", async (appEnv, nodeEnv, color) => {
  vi.stubEnv("APP_ENV", appEnv); vi.stubEnv("NODE_ENV", nodeEnv);
  expect(getBrandIconColor()).toBe(color);
  const response = GET();
  expect(response.headers.get("content-type")).toBe("image/svg+xml");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.text()).toContain(`fill="${color}"`);
});
