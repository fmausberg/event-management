// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UnsavedChangesForm, UnsavedChangesGuard } from "@/components/unsaved-changes";

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

async function mountEditor() {
  await act(async () => root.render(createElement(StrictMode, null,
    createElement(UnsavedChangesGuard),
    createElement(UnsavedChangesForm, null, createElement("input", { name: "name", defaultValue: "Original" })),
    createElement("a", { href: "/events", onClick: event => event.preventDefault() }, "Veranstaltungen"),
  )));
}

it("blocks the menu link after editing an event series", async () => {
  await mountEditor();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  container.querySelector("input")!.value = "Changed";
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  container.querySelector("a")!.dispatchEvent(event);
  expect(confirm).toHaveBeenCalledOnce();
  expect(event.defaultPrevented).toBe(true);
});

it("requests the browser warning when closing a tab with an edited event", async () => {
  await mountEditor();
  container.querySelector("input")!.value = "Changed";
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
});
