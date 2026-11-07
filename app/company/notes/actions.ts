"use server";

import { ZodError } from "zod";
import { withSessionAudit } from "@/lib/audit/session";
import { MemberAccessError } from "@/lib/companies/members";
import * as notes from "@/lib/notes/service";

async function run<T>(source: string, work: () => Promise<T>) {
  return withSessionAudit(source, async () => {
    try { return { success: true as const, data: await work() }; }
    catch (error) {
      if (error instanceof ZodError) return { success: false as const, message: "Bitte prüfe deine Eingaben. Der Notiztext darf nicht leer sein." };
      if (error instanceof MemberAccessError || error instanceof notes.NoteAccessError) return { success: false as const, message: error.message };
      return { success: false as const, message: "Die Notizoperation konnte nicht abgeschlossen werden. Bitte versuche es erneut." };
    }
  });
}

export async function createNote(target: unknown, content: unknown) {
  return run("company/notes.createNote", () => notes.createNote(target, content));
}

export async function listNotes(target: unknown) {
  return run("company/notes.listNotes", () => notes.listNotes(target));
}

export async function updateNote(id: unknown, content: unknown) {
  return run("company/notes.updateNote", () => notes.updateNote(id, content));
}

export async function deleteNote(id: unknown) {
  return run("company/notes.deleteNote", async () => { await notes.deleteNote(id); return null; });
}
