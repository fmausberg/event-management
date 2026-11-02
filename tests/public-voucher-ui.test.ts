// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PublicBookingForm } from "@/components/public-booking-form";
import { previewPublicVoucher, type PublicVoucherState } from "@/app/(public)/events/[companySlug]/[eventId]/actions";
vi.mock("@/app/(public)/events/[companySlug]/[eventId]/actions", () => ({ bookPublicEvent: vi.fn(), previewPublicVoucher: vi.fn() }));
let host: HTMLDivElement, root: Root;
beforeEach(async () => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(createElement(PublicBookingForm, { slug: "studio", eventId: "event", token: "token", price: "100", currency: "EUR", available: 10, started: false, initialEmail: "user@example.com" })));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function code(value: string) {
  const field = host.querySelector<HTMLInputElement>('#voucher-code')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("checks on click and shows loading for five seconds without locking further attempts", async () => {
  let resolve!: (value: PublicVoucherState) => void;
  vi.mocked(previewPublicVoucher).mockReturnValue(new Promise(done => { resolve = done; }));
  await code("COPIED-CODE");
  expect(previewPublicVoucher).not.toHaveBeenCalled();
  const button = host.querySelector<HTMLButtonElement>('button[type="button"]')!;
  await act(async () => button.click());
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(button.querySelector(".animate-spin")).not.toBeNull();
  await act(async () => resolve({ message: "Ungültiger Code" }));
  await act(async () => vi.advanceTimersByTimeAsync(4999));
  expect(button.disabled).toBe(true);
  expect(host.textContent).not.toContain("Ungültiger Code");
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(button.disabled).toBe(false);
  expect(host.textContent).toContain("Ungültiger Code");
  expect(button.querySelector(".animate-spin")).toBeNull();
  await code("");
  expect(host.querySelector<HTMLButtonElement>('button:not([type="button"])')!.disabled).toBe(false);
});

it("waits for a slower server and also delays technical errors", async () => {
  let reject!: (reason: Error) => void;
  vi.mocked(previewPublicVoucher).mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
  await code("CODE");
  const button = host.querySelector<HTMLButtonElement>('button[type="button"]')!;
  await act(async () => button.click());
  await act(async () => vi.advanceTimersByTimeAsync(6000));
  expect(button.disabled).toBe(true);
  await act(async () => reject(new Error("Network")));
  expect(button.disabled).toBe(false);
  expect(host.textContent).toContain("Die Gutscheinprüfung ist derzeit nicht verfügbar.");
});
