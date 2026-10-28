// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VerificationForm } from "@/app/(auth)/verify-email/verification-form";
import { loadVerificationEmail, verifyEmail } from "@/app/(auth)/verify-email/actions";

vi.mock("@/app/(auth)/verify-email/actions", () => ({
  loadVerificationEmail: vi.fn().mockResolvedValue("ada@example.com"),
  verifyEmail: vi.fn().mockResolvedValue({ success: true, message: "E-Mail bestätigt." }),
  resendVerification: vi.fn(),
}));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it("keeps the fragment token through Strict Mode effect replay and verifies only on submit", async () => {
  const token = "a".repeat(43);
  window.history.replaceState(null, "", `/verify-email#${token}`);
  await act(async () => root.render(createElement(StrictMode, null, createElement(VerificationForm))));

  expect(window.location.hash).toBe("");
  expect(container.querySelector<HTMLInputElement>('input[name="token"]')?.value).toBe(token);
  expect(container.textContent).toContain("ada@example.com");
  expect(loadVerificationEmail).toHaveBeenCalledWith(token);
  expect(verifyEmail).not.toHaveBeenCalled();
  expect(container.querySelector('input[name="email"]')).toBeNull();

  await act(async () => container.querySelector("form")!.requestSubmit());
  expect(verifyEmail).toHaveBeenCalledTimes(1);
  expect(vi.mocked(verifyEmail).mock.calls[0][1].get("token")).toBe(token);
  expect(container.textContent).toContain("E-Mail bestätigt.");
});

it("offers a new verification email when opened without a fragment", async () => {
  window.history.replaceState(null, "", "/verify-email");
  await act(async () => root.render(createElement(StrictMode, null, createElement(VerificationForm))));
  expect(container.querySelector('input[name="email"]')).not.toBeNull();
  expect(container.querySelector('input[name="token"]')).toBeNull();
  expect(loadVerificationEmail).not.toHaveBeenCalled();
});
