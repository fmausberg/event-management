// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SeriesPreviewDialog } from "@/app/company/[companyKey]/event-series/_components/series-preview-dialog";

it("requires visits, keeps attribute selections independent and cancels without applying", async () => {
 Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
 HTMLDialogElement.prototype.showModal = function () { this.open = true; };
 HTMLDialogElement.prototype.close = function () { this.open = false; };
 const host = document.createElement("div"); document.body.append(host);
 const root = createRoot(host); const apply = vi.fn(); const cancel = vi.fn();
 await act(async () => root.render(createElement(SeriesPreviewDialog, { pending: false, onApply: apply, onCancel: cancel, preview: { token: "test", tabs: [
  { key: "name", label: "Name", rows: [{ id: "one", date: "01.01.2099", before: "Old", after: "New" }] },
  { key: "suggestedTicketPrice", label: "Ticketpreis", rows: [{ id: "one", date: "01.01.2099", before: "10 EUR", after: "20 EUR" }] },
  { key: "description", label: "Beschreibung", rows: [] },
 ] } })));
 const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === text)!;
 expect(button("Übernehmen").disabled).toBe(true);
 await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
 await act(async () => (host.querySelectorAll('[role="tab"]')[1] as HTMLButtonElement).click());
 expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);
 expect(button("Übernehmen").disabled).toBe(true);
 await act(async () => button("Alle Vorschauen ansehen").click());
 expect(button("Übernehmen").disabled).toBe(false);
 await act(async () => button("Übernehmen").click());
 expect(apply).toHaveBeenCalledWith({ name: [], suggestedTicketPrice: ["one"], description: [] });
 await act(async () => (host.querySelectorAll('[role="tab"]')[2] as HTMLButtonElement).click());
 expect(host.textContent).toContain("keine betroffenen zukünftigen Events");
 await act(async () => button("Abbrechen").click());
 expect(cancel).toHaveBeenCalledOnce(); expect(apply).toHaveBeenCalledOnce();
 await act(async () => root.unmount()); host.remove();
});
