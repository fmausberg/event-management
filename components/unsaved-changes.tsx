"use client";

import { useEffect, useRef, type ComponentPropsWithRef } from "react";

const warning = "Es gibt ungespeicherte Änderungen. Möchtest du die Seite wirklich verlassen? Die Änderungen gehen verloren.";
type Editor = { dirty: () => boolean; accept: () => void };
const editors = new Map<HTMLFormElement, Editor>();

function confirmLeaving(forms = [...editors.keys()]) {
  const changed = forms.filter(form => form.isConnected && editors.get(form)?.dirty());
  if (!changed.length) return true;
  if (!window.confirm(warning)) return false;
  changed.forEach(form => editors.get(form)?.accept());
  return true;
}

// Read controls directly, including disabled fields while a save is pending and
// controls associated with the form through their `form` attribute.
function snapshot(form: HTMLFormElement, scope?: Element) {
  const values: unknown[] = [];
  for (const element of Array.from(form.elements)) {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) continue;
    if (element.closest("[data-unsaved-ignore]")) continue;
    if (scope ? !scope.contains(element) : element.closest("[data-unsaved-initial-values]")) continue;
    if (element instanceof HTMLInputElement) {
      if (["submit", "button", "reset"].includes(element.type)) continue;
      if (element.type === "file") {
        values.push([element.name, Array.from(element.files ?? []).map(file => [file.name, file.size, file.lastModified])]);
        continue;
      }
      if (["checkbox", "radio"].includes(element.type)) {
        values.push([element.name, element.value, element.checked]);
        continue;
      }
    }
    values.push([element.name, element instanceof HTMLSelectElement && element.multiple ? Array.from(element.selectedOptions).map(option => option.value) : element.value]);
  }
  return JSON.stringify(values);
}

/** Use for editors that require an explicit save; filters and immediate actions stay ordinary forms. */
export function UnsavedChangesForm({ ref, saveState, additionalDirty = false, onReset, ...props }: ComponentPropsWithRef<"form"> & { saveState?: { success?: boolean }; additionalDirty?: boolean }) {
  const element = useRef<HTMLFormElement | null>(null);
  const baseline = useRef("");
  const allowReset = useRef(false);
  const extraDirty = useRef(additionalDirty);
  useEffect(() => { extraDirty.current = additionalDirty; }, [additionalDirty]);
  useEffect(() => {
    const form = element.current!;
    const sectionBaselines = new Map<Element, string>();
    const sections = () => Array.from(form.querySelectorAll<HTMLElement>("[data-unsaved-initial-values]"));
    baseline.current = snapshot(form);
    editors.set(form, {
      dirty: () => extraDirty.current || snapshot(form) !== baseline.current || sections().some(section => {
        // Loading an async editor section is not a user edit.
        const original = sectionBaselines.get(section) ?? section.dataset.unsavedInitialValues;
        return snapshot(form, section) !== original;
      }),
      accept: () => {
        extraDirty.current = false;
        baseline.current = snapshot(form);
        sections().forEach(section => sectionBaselines.set(section, snapshot(form, section)));
      },
    });
    return () => { editors.delete(form); };
  }, []);
  useEffect(() => {
    if (saveState?.success && element.current) {
      // Preserve successful actions' normal reset behavior, while rejected
      // actions keep the user's input available for correction.
      allowReset.current = true;
      element.current.reset();
      allowReset.current = false;
      editors.get(element.current)?.accept();
    }
  }, [saveState]);
  return <form {...props} ref={form => {
    element.current = form;
    if (typeof ref === "function") ref(form);
    else if (ref) ref.current = form;
  }} onReset={event => {
    // React otherwise clears uncontrolled fields even after a rejected save.
    if (!allowReset.current) event.preventDefault();
    onReset?.(event);
  }} />;
}

export function UnsavedChangesGuard() {
  useEffect(() => {
    // Stamp entries without replacing Next's own state. On a cancelled history
    // traversal, restore the previous entry before the router handles popstate.
    const positionKey = "__unsavedChangesPosition";
    let position: number = history.state?.[positionKey] ?? 0;
    let restoring = false;
    const originalPush = history.pushState;
    const originalReplace = history.replaceState;
    const push: History["pushState"] = function (this: History, state, unused, url) {
      originalPush.call(this, { ...state, [positionKey]: position + 1 }, unused, url);
      position += 1;
    };
    const replace: History["replaceState"] = function (this: History, state, unused, url) {
      originalReplace.call(this, { ...state, [positionKey]: position }, unused, url);
    };
    history.replaceState = replace;
    history.pushState = push;
    replace.call(history, history.state, "");
    const popstate = (event: PopStateEvent) => {
      if (restoring) {
        restoring = false;
        event.stopImmediatePropagation();
        return;
      }
      const next: unknown = event.state?.[positionKey];
      if (typeof next !== "number") return;
      if (next !== position && !confirmLeaving()) {
        restoring = true;
        event.stopImmediatePropagation();
        history.go(position - next);
        return;
      }
      position = next;
    };

    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (![...editors].some(([form, editor]) => form.isConnected && editor.dirty())) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const click = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const discard = event.target.closest<HTMLElement>("[data-discard-changes]");
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      let forms: HTMLFormElement[] | undefined;
      if (discard) {
        const form = discard instanceof HTMLButtonElement ? discard.form : discard.closest("form");
        const dialog = discard.closest("dialog");
        forms = form ? [form] : dialog ? [...editors.keys()].filter(editor => dialog.contains(editor)) : undefined;
      } else {
        if (!link || link.closest('[contenteditable="true"]') || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
        const destination = new URL(link.href, location.href);
        if (!["http:", "https:"].includes(destination.protocol) || (destination.pathname === location.pathname && destination.search === location.search && destination.hash)) return;
      }
      if (!confirmLeaving(forms)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const cancel = (event: Event) => {
      if (!(event.target instanceof HTMLDialogElement)) return;
      const forms = [...editors.keys()].filter(form => event.target instanceof Element && event.target.contains(form));
      if (!confirmLeaving(forms)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const submit = (event: SubmitEvent) => {
      // Saving an editor is allowed. Other actions (such as signing out) leave it.
      if (event.target instanceof HTMLFormElement && !editors.has(event.target) && !confirmLeaving()) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("popstate", popstate, true);
    document.addEventListener("click", click, true);
    document.addEventListener("cancel", cancel, true);
    document.addEventListener("submit", submit, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("popstate", popstate, true);
      if (history.pushState === push) history.pushState = originalPush;
      if (history.replaceState === replace) history.replaceState = originalReplace;
      document.removeEventListener("click", click, true);
      document.removeEventListener("cancel", cancel, true);
      document.removeEventListener("submit", submit, true);
    };
  }, []);
  return null;
}
