// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EventsTable } from "@/app/company/[companyKey]/events/_components/events-table";
import { BatchDates } from "@/app/company/[companyKey]/events/_components/batch-dates";
import { saveEvent, getSeriesDateConflicts } from "@/app/company/[companyKey]/events/actions";
import type { SeriesRow } from "@/lib/event-series/validation";
import type { BatchSelection } from "@/lib/company-events/batch-schedule";

vi.mock("server-only", () => ({}));
vi.mock("@/app/company/[companyKey]/events/actions", () => ({ saveEvent: vi.fn(), getSeriesDateConflicts: vi.fn(), deleteEvent: vi.fn(), sendTrainerInfo: vi.fn() }));
vi.mock("@/components/trainer-picker", () => ({ TrainerPicker: () => null }));
const series: SeriesRow = { id: "series", number: 1, name: "Workshopreihe", shortdescription: "Kurz", description: "Beschreibung", imageUrl: null, suggestedDuration: 90, suggestedMaxSeats: 20, suggestedTicketPrice: "19.50", suggestedCurrency: "EUR", suggestedTrainerId: null, suggestedTrainerName: null, suggestedVenueId: "venue", suggestedFreeCancellationUntilMinutesBeforeStart: 1440, _count: { events: 0 } };
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2027-03-01T10:00:00Z"));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => { callback(); return 0; });
  Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
  Object.defineProperties(HTMLDialogElement.prototype, { show: { configurable: true, value() { this.open = true; } }, showModal: { configurable: true, value() { this.open = true; } }, close: { configurable: true, value() { this.open = false; } } });
  vi.mocked(getSeriesDateConflicts).mockResolvedValue({ dates: [] });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function change(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLSelectElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event("change", { bubbles: true })); element.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function openForm(withSeries = true) {
  await act(async () => root.render(createElement(EventsTable, { company: { name: "Studio", slug: "studio" }, events: [], series: [series], venues: [{ id: "venue", name: "Studio" }], trainers: [], canManage: true, defaultSeriesId: withSeries ? "series" : undefined })));
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "+ Event erstellen")!.click());
}
async function chooseMultiple() {
  await act(async () => host.querySelector<HTMLInputElement>('input[value="multiple"]')!.click());
  await act(async () => vi.advanceTimersByTimeAsync(300));
}
async function chooseTwo() {
  for (const date of ["01.03.2027", "02.03.2027"]) await act(async () => host.querySelector<HTMLButtonElement>(`button[aria-label="${date}"]`)!.click());
  await change(host.querySelector<HTMLInputElement>('input[name="batchStartTime"]')!, "10:00");
}

it("requires a series and preserves common form values when switching creation modes", async () => {
  await openForm(false);
  expect(host.querySelector<HTMLInputElement>('input[value="multiple"]')!.disabled).toBe(true);
  await change(host.querySelector<HTMLSelectElement>("#event-series")!, "series");
  expect(host.querySelector<HTMLInputElement>("#event-name")!.value).toBe("Workshopreihe");
  await change(host.querySelector<HTMLInputElement>("#event-name")!, "Eigener Titel");
  await chooseMultiple();
  expect(host.querySelector("#event-beginsAt")).toBeNull();
  expect(host.querySelector<HTMLInputElement>("#event-name")!.value).toBe("Eigener Titel");
  await chooseTwo();
  await act(async () => host.querySelector<HTMLInputElement>('input[value="single"]')!.click());
  expect(host.querySelector("#event-beginsAt")).not.toBeNull();
  expect(host.querySelector<HTMLInputElement>("#event-name")!.value).toBe("Eigener Titel");
  await chooseMultiple();
  expect(host.querySelectorAll('input[name="batchDate"]')).toHaveLength(2);
});

it("retains selection and inputs after server errors, then closes with the batch success message", async () => {
  await openForm(); await chooseMultiple(); await chooseTwo();
  vi.mocked(saveEvent).mockResolvedValueOnce({ message: "Bitte korrigieren.", errors: { name: ["Ungültiger Name"] } }).mockResolvedValueOnce({ success: true, message: "2 Events wurden als Entwurf erstellt." });
  const submit = () => host.querySelector<HTMLFormElement>("dialog form")!.requestSubmit(host.querySelector<HTMLButtonElement>('button[value="draft"]')!);
  await act(async () => submit());
  expect(host.textContent).toContain("Bitte korrigieren.");
  expect(host.querySelectorAll('input[name="batchDate"]')).toHaveLength(2);
  expect(host.querySelector<HTMLInputElement>('input[name="batchStartTime"]')!.value).toBe("10:00");
  expect(host.querySelector<HTMLInputElement>("#event-name")!.value).toBe("Workshopreihe");
  const submitted = vi.mocked(saveEvent).mock.calls[0][3];
  expect(submitted.getAll("batchDate")).toEqual(["2027-03-01", "2027-03-02"]);
  expect(submitted.get("creationMode")).toBe("multiple");
  expect(submitted.get("beginsAt")).toBeNull();
  await act(async () => submit());
  expect(host.querySelector("dialog")).toBeNull();
  expect(host.textContent).toContain("2 Events wurden als Entwurf erstellt.");
});

it("asks once for optional fields across the whole batch before resubmitting publication", async () => {
  await openForm(); await chooseMultiple(); await chooseTwo();
  vi.mocked(saveEvent).mockResolvedValueOnce({ warnings: ["Titelbild", "Trainer"] }).mockResolvedValueOnce({ success: true, message: "2 Events wurden veröffentlicht." });
  await act(async () => host.querySelector<HTMLFormElement>("dialog form")!.requestSubmit(host.querySelector<HTMLButtonElement>('button[value="publish"]')!));
  expect(host.textContent).toContain("2 Events sind bereit zur Veröffentlichung");
  expect(saveEvent).toHaveBeenCalledOnce();
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Trotzdem veröffentlichen")!.click());
  expect(saveEvent).toHaveBeenCalledTimes(2);
  expect(vi.mocked(saveEvent).mock.calls[1][3].get("confirmMissingOptional")).toBe("yes");
  expect(host.textContent).toContain("2 Events wurden veröffentlicht.");
});

it("shows Monday-to-Sunday calendar pages and lets users remove a selected conflicting date", async () => {
  vi.mocked(getSeriesDateConflicts).mockResolvedValue({ dates: ["2027-03-01"] });
  function Picker() {
    const [value, setValue] = useState<BatchSelection>({ dates: ["2027-03-01"], startTime: "10:00", endTime: "11:00", endDayOffset: "0", timeMode: "clock", duration: "" });
    return createElement(BatchDates, { slug: "studio", seriesId: "series", value, onChange: setValue, suggestedDuration: null });
  }
  await act(async () => root.render(createElement(Picker)));
  await act(async () => vi.advanceTimersByTimeAsync(300));
  const grid = host.querySelector('[aria-label="Terminauswahl Montag bis Sonntag"]')!;
  expect([...grid.children].slice(0, 7).map(element => element.textContent)).toEqual(["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]);
  expect(host.textContent).toContain("1 ausgewählte Termine sind bereits belegt");
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Belegte Termine entfernen")!.click());
  expect(host.querySelectorAll('input[name="batchDate"]')).toHaveLength(0);
  const occupiedDay = grid.querySelector<HTMLButtonElement>('button[aria-label="01.03.2027 – bereits belegt"]')!;
  expect(occupiedDay.disabled).toBe(false);
  expect(occupiedDay.textContent).toContain("belegt");
  await act(async () => occupiedDay.click());
  expect(occupiedDay.getAttribute("aria-pressed")).toBe("true");
  expect(host.querySelectorAll('input[name="batchDate"]')).toHaveLength(1);
  expect(host.textContent).toContain("ein zusätzliches Event angelegt");
  const rangeEnd = host.querySelectorAll<HTMLInputElement>('input[type="date"]')[1];
  await change(rangeEnd, "2027-06-01");
  const next = [...host.querySelectorAll("button")].find(button => button.textContent === "Weiter →")!;
  expect(next.disabled).toBe(false);
  await act(async () => next.click());
  expect(host.textContent).toContain("Seite 2 / 3");
});
