// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GuestBookingManagement } from "@/app/(public)/booking/manage/guest-booking-management";
import { TicketView } from "@/components/ticket-view";

const { loadBooking, cancelBooking } = vi.hoisted(() => ({ loadBooking: vi.fn(), cancelBooking: vi.fn() }));
vi.mock("@/app/(public)/booking/manage/actions", () => ({ loadGuestBooking: loadBooking, cancelGuestBooking: cancelBooking }));
vi.mock("@/components/ticket-card", () => ({ TicketCard: () => createElement("div", null, "Ticket") }));

const booking = { number: 42, quantity: 3, status: "CONFIRMED", eventName: "Yoga", companyName: "Studio", beginsAt: "2026-11-05T12:00:00Z", deadline: "2026-11-04T12:00:00Z", free: true, canCancel: true, unavailableReason: null, cancellation: null };
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState(null, "", "/booking/manage#management-token");
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  loadBooking.mockResolvedValue({ booking });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it("loads without login, explains the full scope and requires confirmation before submitting", async () => {
  await act(async () => root.render(createElement(GuestBookingManagement)));
  expect(loadBooking).toHaveBeenCalledWith("management-token");
  expect(cancelBooking).not.toHaveBeenCalled();
  expect(container.textContent).toContain("alle 3 Tickets");
  const form = container.querySelector("form")!;
  const confirmation = form.querySelector<HTMLInputElement>('input[name="confirmed"]')!;
  expect(confirmation.required).toBe(true);
  expect(form.checkValidity()).toBe(false);
  confirmation.checked = true;
  cancelBooking.mockResolvedValue({ success: true, booking: { ...booking, status: "CANCELLED", canCancel: false }, message: "Alle Tickets sind storniert." });
  await act(async () => form.requestSubmit());
  expect(cancelBooking.mock.calls[0][0]).toBe("management-token");
  const submitted = cancelBooking.mock.calls[0][2] as FormData;
  expect(submitted.get("confirmed")).toBe("yes");
  expect(submitted.get("intent")).toBe("free");
  expect(container.textContent).toContain("Alle Tickets sind storniert.");
  expect(container.querySelector("form")).toBeNull();
});

it("offers a request when the free window is closed", async () => {
  loadBooking.mockResolvedValue({ booking: { ...booking, free: false } });
  await act(async () => root.render(createElement(GuestBookingManagement)));
  expect(container.textContent).toContain("Bis zur Genehmigung bleiben deine Tickets gültig");
  expect(container.querySelector<HTMLInputElement>('input[name="intent"]')?.value).toBe("request");
});

it("does not offer cancellation for an invalid link", async () => {
  loadBooking.mockResolvedValue({ message: "Der Verwaltungslink ist ungültig." });
  await act(async () => root.render(createElement(GuestBookingManagement)));
  expect(container.textContent).toContain("ungültig");
  expect(container.querySelector("form")).toBeNull();
});

it("offers only cancellation guidance on a forwarded ticket, never booking management access", async () => {
  window.history.replaceState(null, "", `/tickets#${"a".repeat(43)}`);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ number: 7 }) }));
  await act(async () => root.render(createElement(TicketView)));
  expect(container.querySelector("summary")?.textContent).toBe("Informationen zur Stornierung");
  expect(container.textContent).toContain("ursprünglichen Buchungsbestätigung");
  expect(container.querySelector('a[href*="booking/manage"]')).toBeNull();
  expect(loadBooking).not.toHaveBeenCalled();
  expect(cancelBooking).not.toHaveBeenCalled();
});
