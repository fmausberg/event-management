// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { VoucherCampaignForm, VoucherIssueForm } from "@/components/voucher-admin-forms";
import { createCodes } from "@/app/company/[companyKey]/vouchers/actions";
vi.mock("@/app/company/[companyKey]/vouchers/actions", () => ({ saveCampaign: vi.fn(), setCampaignStatus: vi.fn(), createCodes: vi.fn(), setCodeStatus: vi.fn() }));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.resetAllMocks(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
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
