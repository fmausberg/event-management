import "server-only";
import { notFound, redirect } from "next/navigation";
import { MemberAccessError, requireCompanyAccess } from "@/lib/companies/members";

export async function requireImportPageAccess(slug: string) {
  try { return await requireCompanyAccess(slug); }
  catch (error) {
    if (error instanceof MemberAccessError) {
      if (error.reason === "UNAUTHENTICATED") redirect("/login");
      notFound();
    }
    throw error;
  }
}
