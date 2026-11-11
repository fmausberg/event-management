// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EventForm } from "@/app/company/[companyKey]/events/_components/events-table";
import { saveEvent } from "@/app/company/[companyKey]/events/actions";
import type { EventRow } from "@/lib/company-events/model";

vi.mock("server-only", () => ({}));
vi.mock("@/app/company/[companyKey]/events/actions", () => ({ saveEvent: vi.fn(), deleteEvent: vi.fn(), sendTrainerInfo: vi.fn() }));
vi.mock("@/components/trainer-picker", () => ({ TrainerPicker: () => null }));
vi.mock("@/components/description-editor", () => ({ DescriptionEditor: () => null }));

let host: HTMLDivElement, root: Root;
const onSaved = vi.fn();
const row: EventRow = {
  id: "event-1", number: 1, name: "Yoga", beginsAt: "2099-01-01T10:00:00Z", endsAt: "2099-01-01T11:00:00Z",
  status: "PUBLISHED", currency: "EUR", ticketPrice: "10.00", maxSeats: 20, remainingSeats: 18, checkedInSeats: 0, purchasedSeats: 2,
  shortdescription: "", description: "", trainerIds: [], trainerName: null, imageUrl: null, eventSeriesId: "", venueId: "",
  freeCancellationUntilMinutesBeforeStart: "", _count: { bookings: 2, platformEvents: 0 },
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => { callback(); return 0; });
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value() { this.open = true; } },
    close: { configurable: true, value() { this.open = false; } },
  });
  vi.mocked(saveEvent).mockResolvedValue({ success: true, message: "Gespeichert" });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(bookings = 2) {
  await act(async () => root.render(createElement(EventForm, { inline: true, slug: "yoga", row: { ...row, _count: { ...row._count, bookings } }, series: [], venues: [], trainers: [], onSaved, onCancel: vi.fn() })));
}
async function submit() {
  await act(async () => host.querySelector<HTMLFormElement>("form")!.requestSubmit(host.querySelector<HTMLButtonElement>('button[value="save"]')!));
}
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("dialog button")].find(item => item.textContent === text)!;

it("warns about bookings and participant notification before saving", async () => {
  await render(); await submit();
  expect(host.querySelector("dialog")?.open).toBe(true);
  expect(host.querySelector("dialog")?.textContent).toContain("Bitte informiere die Teilnehmenden");
  expect(saveEvent).not.toHaveBeenCalled();
  await act(async () => button("Änderungen speichern").click());
  expect(saveEvent).toHaveBeenCalledOnce();
  expect(onSaved).toHaveBeenCalledWith("Gespeichert", undefined);
});

it.each(["back", "escape"])("keeps edits and asks again after dismissing via %s", async (dismiss) => {
  await render();
  const name = host.querySelector<HTMLInputElement>("#event-name")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Neuer Titel");
    name.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await submit();
  await act(async () => {
    if (dismiss === "back") button("Zurück zum Bearbeiten").click();
    else host.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true }));
  });
  expect(saveEvent).not.toHaveBeenCalled();
  expect(onSaved).not.toHaveBeenCalled();
  expect(host.querySelector("dialog")).toBeNull();
  expect(name.value).toBe("Neuer Titel");
  expect(name.disabled).toBe(false);
  await submit();
  expect(host.querySelector("dialog")?.open).toBe(true);
  expect(saveEvent).not.toHaveBeenCalled();
});

it("saves directly when there are no bookings", async () => {
  await render(0); await submit();
  expect(host.querySelector("dialog")).toBeNull();
  expect(saveEvent).toHaveBeenCalledOnce();
});
