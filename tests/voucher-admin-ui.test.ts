// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { VoucherCampaignForm, VoucherIssueForm } from "@/components/voucher-admin-forms";
import { VoucherCampaignsTable } from "@/components/voucher-campaigns-table";
import type { VoucherAdministration } from "@/lib/vouchers/admin-data";
import { createCodes } from "@/app/company/[companyKey]/vouchers/actions";
vi.mock("@/app/company/[companyKey]/vouchers/actions", () => ({ saveCampaign: vi.fn(), setCampaignStatus: vi.fn(), createCodes: vi.fn(), setCodeStatus: vi.fn() }));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.resetAllMocks(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })) });
  Object.defineProperties(HTMLDialogElement.prototype, { show: { configurable: true, value() { this.open = true; } }, showModal: { configurable: true, value() { this.open = true; } }, close: { configurable: true, value() { this.open = false; } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it("shows plaintext only after issuance and removes it on leaving the form", async () => {
  vi.mocked(createCodes).mockResolvedValue({ success: true, codes: ["VG-ONE-TIME-TEST"], message: "Gespeichert" });
  await act(async () => root.render(createElement(VoucherIssueForm, { slug: "studio", campaignId: "campaign", stored: true, requestId: "request" })));
  expect(host.textContent).not.toContain("VG-ONE-TIME-TEST");
  await act(async () => host.querySelector("form")!.requestSubmit());
  expect(host.querySelector("textarea")?.value).toBe("VG-ONE-TIME-TEST");
  expect(host.querySelector("form")).toBeNull();
  expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
  await act(async () => root.render(createElement("div", null, "Übersicht")));
  vi.mocked(createCodes).mockResolvedValue({ success: true, replay: true, codes: [], message: "Bereits ausgegeben" });
  await act(async () => root.render(createElement(VoucherIssueForm, { slug: "studio", campaignId: "campaign", stored: true, requestId: "request" })));
  await act(async () => host.querySelector("form")!.requestSubmit());
  expect(host.querySelector("textarea")).toBeNull(); expect(host.textContent).not.toContain("VG-ONE-TIME-TEST");
});
it("offers all four combinable targets and describes the one-ticket 100-percent default", async () => {
  await act(async () => root.render(createElement(VoucherCampaignForm, { slug: "studio", start: "2099-01-01T12:00", options: {
    companies: [{ id: "company", name: "Company" }], series: [{ id: "series", name: "Reihe" }], events: [{ id: "event", name: "Event" }], venues: [{ id: "venue", name: "Venue" }],
  } })));
  for (const name of ["companyIds", "seriesIds", "eventIds", "venueIds"]) expect(host.querySelector(`input[name="${name}"]`)).not.toBeNull();
  expect(host.textContent).toContain("ODER"); expect(host.textContent).toContain("genau ein Ticket kostenlos");
});
it("never offers public shared balances in the stored-value issuance form", async () => {
  await act(async () => root.render(createElement(VoucherIssueForm, { slug: "studio", campaignId: "campaign", stored: true, requestId: "request" })));
  expect(host.querySelector('option[value="PUBLIC"]')).toBeNull();
  expect(host.textContent).toContain("ohne Verkauf oder Zahlung");
});
it("explains that a campaign can receive multiple separately issued public codes", async () => {
  await act(async () => root.render(createElement(VoucherIssueForm, { slug: "studio", campaignId: "campaign", stored: false, requestId: "request" })));
  expect(host.querySelector('option[value="PUBLIC"]')).not.toBeNull();
  expect(host.textContent).toContain("Mehrere öffentliche Mehrfachcodes");
  const info = host.querySelector<HTMLButtonElement>('button[aria-label="Erklärung zu Öffentlicher Wunschcode (optional, mindestens 8 Zeichen)"]')!;
  await act(async () => info.click());
  expect(host.textContent).toContain("Weitere öffentliche Codes");
});
it("shows campaigns as a table and opens the right-hand editor from plus and pencil", async () => {
  const campaign = { id: "campaign", number: 7, name: "Yoga Sommer", kind: "PERCENTAGE", status: "ACTIVE", percentageBps: 1000, amountMinor: null,
    startsAt: new Date("2099-01-01T10:00:00Z"), endsAt: null, maxRedemptions: 20, maxRedemptionsPerCustomer: null, maxEligibleTicketsPerBooking: null,
    source: "Instagram", policy: null, companyTargets: [{ companyId: "company" }], eventSeriesTargets: [], eventTargets: [], venueTargets: [],
    _count: { codes: 2, redemptions: 1, balanceUses: 0 } };
  const data = { company: { id: "company", name: "MausCon", slug: "mauscon" }, platformAdmin: true, options: { companies: [{ id: "company", name: "MausCon" }], series: [], events: [], venues: [] },
    rows: [{ campaign, stats: { committed: 1, reserved: 0 } }] } as unknown as VoucherAdministration;
  await act(async () => root.render(createElement(VoucherCampaignsTable, { data, start: "2099-01-01T11:00" })));
  expect(host.querySelector("h1")?.textContent).toBe("Kampagnen");
  expect(host.textContent).not.toContain("Company wechseln");
  expect([...host.querySelectorAll("th")].map(cell => cell.textContent)).toEqual(expect.arrayContaining(["Kampagne", "Art und Wert", "Status", "Aktionen"]));
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Neue Kampagne erstellen"]')!.click());
  expect(host.querySelector("dialog")?.open).toBe(true); expect(host.textContent).toContain("Neue Kampagne");
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Formular schließen"]')!.click());
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Yoga Sommer bearbeiten"]')!.click());
  expect(host.querySelector("dialog")?.open).toBe(true); expect(host.textContent).toContain("Kampagne bearbeiten");
});
it("opens and closes an accessible explanation next to a field label", async () => {
  await act(async () => root.render(createElement(VoucherCampaignForm, { slug: "studio", start: "2099-01-01T12:00", options: {
    companies: [], series: [], events: [], venues: [],
  } })));
  const info = host.querySelector<HTMLButtonElement>('button[aria-label="Erklärung zu Limit je Kundenidentität"]')!;
  expect(info).not.toBeNull();
  expect(info.getAttribute("aria-expanded")).toBe("false");
  expect(host.textContent).not.toContain("normalisierte Buchungs-E-Mail");
  await act(async () => info.click());
  expect(info.getAttribute("aria-expanded")).toBe("true");
  expect(host.querySelector(`[id="${info.getAttribute("aria-controls")}"]`)?.textContent).toContain("normalisierte Buchungs-E-Mail");
  await act(async () => info.click());
  expect(info.getAttribute("aria-expanded")).toBe("false");
  expect(host.textContent).not.toContain("normalisierte Buchungs-E-Mail");
});
