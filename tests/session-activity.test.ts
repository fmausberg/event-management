import { afterEach, expect, it, vi } from "vitest";
import { SessionActivity } from "@/components/session-activity";

const lifecycle = vi.hoisted(() => ({ cleanup: undefined as undefined | (() => void) }));
vi.mock("react", () => ({
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => () => void) => { lifecycle.cleanup = effect(); },
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/account" }));

afterEach(() => {
  lifecycle.cleanup?.();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("refreshes on activity, throttles requests, and leaves idle or hidden tabs alone", async () => {
  vi.useFakeTimers();
  const browser = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const fetch = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("window", browser);
  vi.stubGlobal("document", document);
  vi.stubGlobal("fetch", fetch);
  SessionActivity();
  await vi.advanceTimersByTimeAsync(0);
  expect(fetch).toHaveBeenCalledTimes(1);
  browser.dispatchEvent(new Event("keydown"));
  expect(fetch).toHaveBeenCalledTimes(1);

  await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
  expect(fetch).toHaveBeenCalledTimes(1);
  browser.dispatchEvent(new Event("pointerdown"));
  await vi.advanceTimersByTimeAsync(0);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch).toHaveBeenLastCalledWith("/api/auth/session", { credentials: "same-origin", cache: "no-store" });

  document.visibilityState = "hidden";
  await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
  browser.dispatchEvent(new Event("scroll"));
  expect(fetch).toHaveBeenCalledTimes(2);
  document.visibilityState = "visible";
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(0);
  expect(fetch).toHaveBeenCalledTimes(3);

  lifecycle.cleanup?.();
  await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
  browser.dispatchEvent(new Event("keydown"));
  expect(fetch).toHaveBeenCalledTimes(3);
});
