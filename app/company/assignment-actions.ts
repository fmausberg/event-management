"use server";
import { notifyAssignment, type AssignmentKind } from "@/lib/mail/assignment";
export async function resendAssignment(kind: AssignmentKind, slug: string, id: string) {
  return notifyAssignment(kind, slug, id);
}
