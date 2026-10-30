// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EventsTable } from "@/app/company/[companyKey]/events/_components/events-table";
import type { EventRow } from "@/lib/company-events/model";

vi.mock("server-only", () => ({}));
vi.mock("@/app/company/[companyKey]/events/actions", () => ({ saveEvent: vi.fn(), deleteEvent: vi.fn() }));
let host: HTMLDivElement, root: Root;
const row = (id: string, number: number, name: string, beginsAt: string): EventRow => ({
  id, number, name, beginsAt, endsAt: beginsAt, status: "DRAFT", currency: "EUR", ticketPrice: "10.00", maxSeats: 20, remainingSeats: number,
  shortdescription: "", description: "", trainerIds: [], trainerName: null, imageUrl: null, eventSeriesId: "", venueId: "",
  freeCancellationUntilMinutesBeforeStart: "", _count: { bookings: number, platformEvents: 0 },
});
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("sorts event rows ascending and descending from column headers", async () => {
  await act(async () => root.render(createElement(EventsTable, { company: { name: "Studio", slug: "studio" }, events: [row("2", 2, "Zulu", "2099-02-01T10:00:00Z"), row("1", 1, "Alpha", "2099-01-01T10:00:00Z")], series: [], venues: [], trainers: [], canManage: false })));
  const names = () => [...host.querySelectorAll("tbody th[scope='row']")].map(cell => cell.textContent);
  expect(host.querySelector("tbody tr td:nth-of-type(2)")?.textContent).toMatch(/^(Mo|Di|Mi|Do|Fr|Sa|So)\./);
  const eventHeader = [...host.querySelectorAll<HTMLButtonElement>("thead button")].find(button => button.textContent?.includes("Event"))!;
  await act(async () => eventHeader.click());
  expect(names()).toEqual(["Alpha", "Zulu"]); expect(eventHeader.closest("th")?.getAttribute("aria-sort")).toBe("ascending");
  await act(async () => eventHeader.click());
  expect(names()).toEqual(["Zulu", "Alpha"]); expect(eventHeader.closest("th")?.getAttribute("aria-sort")).toBe("descending");
});

it("separates week, venue and status groups for the active sort", async () => {
  const first = row("1", 1, "Alpha", "2099-01-01T10:00:00Z");
  const second = row("2", 2, "Zulu", "2099-02-01T10:00:00Z");
  first.venueId = "venue-a";
  second.venueId = "venue-b";
  second.status = "PUBLISHED";
  await act(async () => root.render(createElement(EventsTable, {
    company: { name: "Studio", slug: "studio" }, events: [second, first], series: [],
    venues: [{ id: "venue-a", name: "Alpha-Ort" }, { id: "venue-b", name: "Zulu-Ort" }], trainers: [], canManage: false,
  })));
  const header = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("thead button")].find(button => button.textContent?.includes(label))!;
  const secondRow = () => host.querySelectorAll("tbody tr")[1];

  await act(async () => header("Beginn").click());
  expect(secondRow().className).toContain("border-t-2");
  await act(async () => header("Orte").click());
  expect(secondRow().className).toContain("border-t-2");
  await act(async () => header("Status").click());
  expect(secondRow().className).toContain("border-t-2");
  await act(async () => header("Event").click());
  expect(secondRow().className).not.toContain("border-t-2");
});

it("shows placeholders for empty weeks when sorting by beginning", async () => {
  await act(async () => root.render(createElement(EventsTable, {
    company: { name: "Studio", slug: "studio" },
    events: [row("2", 2, "Später", "2099-01-15T10:00:00Z"), row("1", 1, "Früher", "2099-01-01T10:00:00Z")],
    series: [], venues: [], trainers: [], canManage: false,
  })));
  const beginningHeader = [...host.querySelectorAll<HTMLButtonElement>("thead button")].find(button => button.textContent?.includes("Beginn"))!;

  await act(async () => beginningHeader.click());
  expect([...host.querySelectorAll("tbody tr")].filter(tableRow => tableRow.textContent?.includes("keine Events"))).toHaveLength(1);
  expect(host.querySelector("tbody td[colspan='10']")?.textContent).toMatch(/^KW \d+\/2099 · keine Events$/);

  await act(async () => beginningHeader.click());
  expect([...host.querySelectorAll("tbody tr")].filter(tableRow => tableRow.textContent?.includes("keine Events"))).toHaveLength(1);
});

it("labels a zero price as kostenlos", async () => {
  const freeEvent = row("1", 1, "Gratis", "2099-01-01T10:00:00Z");
  freeEvent.ticketPrice = "0.00";
  await act(async () => root.render(createElement(EventsTable, {
    company: { name: "Studio", slug: "studio" }, events: [freeEvent], series: [], venues: [], trainers: [], canManage: false,
  })));

  expect(host.querySelector("tbody tr")?.textContent).toContain("kostenlos");
  expect(host.querySelector("tbody tr")?.textContent).not.toContain("0,00 EUR");
});
