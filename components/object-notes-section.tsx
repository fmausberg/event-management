import { getNoteSummaries } from "@/lib/notes/service";
import type { NoteTarget } from "@/lib/notes/validation";
import { ObjectNotes } from "./object-notes";

export async function ObjectNotesSection({ target, label }: { target: NoteTarget; label: string }) {
  const { userId, counts } = await getNoteSummaries(target.type, [target.id]);
  if (counts[target.id] === undefined) return null;
  return <ObjectNotes target={target} label={label} userId={userId} initialCount={counts[target.id]} />;
}
