"use client";
import { useEffect, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
export function DescriptionEditor({ id, value, onChange, invalid = false }: { id: string; value: string; onChange: (html: string) => void; invalid?: boolean }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkError, setLinkError] = useState("");
  const editor = useEditor({
    immediatelyRender: false, shouldRerenderOnTransaction: true,
    extensions: [StarterKit.configure({ heading: false, blockquote: false, code: false, codeBlock: false, horizontalRule: false, strike: false, link: { openOnClick: false, defaultProtocol: "https", HTMLAttributes: { target: null, rel: null } } })],
    content: value,
    editorProps: { attributes: { id, role: "textbox", "aria-label": "Beschreibung", "aria-multiline": "true", "aria-invalid": String(invalid), class: "description-html min-h-32 px-3 py-2 outline-none focus:ring-2 focus:ring-primary-600" } },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });
  useEffect(() => { if (editor && editor.getHTML() !== value) editor.commands.setContent(value, { emitUpdate: false }); }, [editor, value]);
  function closeLink() {
    setLinkOpen(false);
    editor?.chain().focus().run();
  }
  function applyLink() {
    if (!editor) return;
    const entered = linkUrl.trim();
    if (!entered) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      setLinkOpen(false);
      return;
    }
    const href = /^[a-z][a-z\d+.-]*:/i.test(entered) ? entered : `https://${entered}`;
    if (!URL.canParse(href) || !["http:", "https:", "mailto:", "tel:"].includes(new URL(href).protocol)) {
      setLinkError("Bitte gib eine gültige Webadresse, E-Mail-Adresse mit mailto: oder Telefonnummer mit tel: ein.");
      return;
    }
    const chain = editor.chain().focus().extendMarkRange("link");
    if (editor.state.selection.empty && !editor.isActive("link")) {
      chain.insertContent({ type: "text", text: entered, marks: [{ type: "link", attrs: { href } }] }).run();
    } else {
      chain.setLink({ href }).run();
    }
    setLinkOpen(false);
  }
  const buttons = [
    { label: "Fett", mark: "bold", run: () => editor?.chain().focus().toggleBold().run() },
    { label: "Kursiv", mark: "italic", run: () => editor?.chain().focus().toggleItalic().run() },
    { label: "Unterstrichen", mark: "underline", run: () => editor?.chain().focus().toggleUnderline().run() },
    { label: "Liste", mark: "bulletList", run: () => editor?.chain().focus().toggleBulletList().run() },
    { label: "Nummerierte Liste", mark: "orderedList", run: () => editor?.chain().focus().toggleOrderedList().run() },
    { label: "Link", mark: "link", run: () => { setLinkUrl(editor?.getAttributes("link").href ?? ""); setLinkError(""); setLinkOpen(true); } },
  ];
  return <div className="overflow-hidden rounded-lg border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900">
    <div role="group" aria-label="Beschreibung formatieren" className="flex flex-wrap gap-1 border-b border-zinc-200 p-2 dark:border-zinc-700">
      {buttons.map(({ label, mark, run }) => <button key={mark} type="button" disabled={!editor} aria-label={label} title={label} aria-pressed={editor?.isActive(mark) ?? false} onMouseDown={(event) => event.preventDefault()} onClick={run} className="inline-flex h-9 w-9 items-center justify-center rounded text-base hover:bg-primary-50 focus-visible:outline-2 focus-visible:outline-primary-600 aria-pressed:bg-primary-100 aria-pressed:text-primary-900 dark:hover:bg-primary-950">
        {mark === "bold" ? <span aria-hidden="true" className="font-bold">F</span>
          : mark === "italic" ? <span aria-hidden="true" className="font-serif italic">I</span>
          : mark === "underline" ? <span aria-hidden="true" className="underline underline-offset-2">U</span>
          : mark === "link" ? <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 12a4 4 0 0 0 6 0l5-5a4 4 0 0 0-6-6l-1 1" /></svg>
          : <ListIcon numbered={mark === "orderedList"} />}
      </button>)}
    </div>
    {linkOpen && <div role="group" aria-label="Link bearbeiten" className="space-y-2 border-b border-zinc-200 p-3 dark:border-zinc-700">
      <label htmlFor={`${id}-link`} className="block text-sm font-medium">Link-Adresse</label>
      <input data-unsaved-ignore id={`${id}-link`} type="text" autoFocus value={linkUrl} placeholder="https://example.com" aria-invalid={!!linkError} aria-describedby={linkError ? `${id}-link-error` : undefined} onChange={event => { setLinkUrl(event.target.value); setLinkError(""); }} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); applyLink(); } else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeLink(); } }} className="w-full rounded border border-zinc-300 bg-transparent px-3 py-2 text-sm focus-visible:outline-primary-600 dark:border-zinc-700" />
      {linkError && <p id={`${id}-link-error`} role="alert" className="text-sm text-red-700 dark:text-red-300">{linkError}</p>}
      <div className="flex flex-wrap gap-3 text-sm">
        <button type="button" onClick={applyLink} className="rounded bg-primary-600 px-3 py-1.5 text-white">Übernehmen</button>
        <button type="button" onClick={() => { editor?.chain().focus().extendMarkRange("link").unsetLink().run(); setLinkOpen(false); }} className="underline">Link entfernen</button>
        <button type="button" onClick={closeLink} className="underline">Abbrechen</button>
      </div>
    </div>}
    <input type="hidden" name="description" value={value} />
    <EditorContent editor={editor} />
  </div>;
}

function ListIcon({ numbered }: { numbered: boolean }) {
  return <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 5h12M9 12h12M9 19h12" />
    {numbered ? <g strokeWidth="1.2">
      <path d="m2.5 3 1-.5V7M2.5 7h2" />
      <path d="M2 10.5c0-1.5 3-1.5 3 0 0 1-3 2-3 3.5h3" />
      <path d="M2 17h3l-1.5 2H4a1.5 1.5 0 0 1 0 3H2" />
    </g> : <g fill="currentColor" stroke="none">
      <circle cx="3.5" cy="5" r="1.5" /><circle cx="3.5" cy="12" r="1.5" /><circle cx="3.5" cy="19" r="1.5" />
    </g>}
  </svg>;
}
