"use client";
import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
export function DescriptionEditor({ id, value, onChange, invalid = false }: { id: string; value: string; onChange: (html: string) => void; invalid?: boolean }) {
  const editor = useEditor({
    immediatelyRender: false, shouldRerenderOnTransaction: true,
    extensions: [StarterKit.configure({ heading: false, blockquote: false, code: false, codeBlock: false, horizontalRule: false, strike: false, link: false })],
    content: value,
    editorProps: { attributes: { id, role: "textbox", "aria-label": "Beschreibung", "aria-multiline": "true", "aria-invalid": String(invalid), class: "description-html min-h-32 px-3 py-2 outline-none focus:ring-2 focus:ring-primary-600" } },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });
  useEffect(() => { if (editor && editor.getHTML() !== value) editor.commands.setContent(value, { emitUpdate: false }); }, [editor, value]);
  const buttons = [
    { label: "Fett", mark: "bold", run: () => editor?.chain().focus().toggleBold().run() },
    { label: "Kursiv", mark: "italic", run: () => editor?.chain().focus().toggleItalic().run() },
    { label: "Unterstrichen", mark: "underline", run: () => editor?.chain().focus().toggleUnderline().run() },
    { label: "Liste", mark: "bulletList", run: () => editor?.chain().focus().toggleBulletList().run() },
    { label: "Nummerierte Liste", mark: "orderedList", run: () => editor?.chain().focus().toggleOrderedList().run() },
  ];
  return <div className="overflow-hidden rounded-lg border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900">
    <div role="group" aria-label="Beschreibung formatieren" className="flex flex-wrap gap-1 border-b border-zinc-200 p-2 dark:border-zinc-700">
      {buttons.map(({ label, mark, run }) => <button key={mark} type="button" disabled={!editor} aria-label={label} title={label} aria-pressed={editor?.isActive(mark) ?? false} onMouseDown={(event) => event.preventDefault()} onClick={run} className="inline-flex h-9 w-9 items-center justify-center rounded text-base hover:bg-primary-50 focus-visible:outline-2 focus-visible:outline-primary-600 aria-pressed:bg-primary-100 aria-pressed:text-primary-900 dark:hover:bg-primary-950">
        {mark === "bold" ? <span aria-hidden="true" className="font-bold">F</span>
          : mark === "italic" ? <span aria-hidden="true" className="font-serif italic">I</span>
          : mark === "underline" ? <span aria-hidden="true" className="underline underline-offset-2">U</span>
          : <ListIcon numbered={mark === "orderedList"} />}
      </button>)}
    </div>
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
