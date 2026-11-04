import "server-only";
import { auth } from "@/auth";
import { withAuditContext } from "./context";

// Authentication establishes provenance; each action retains its own authorization.
export async function withSessionAudit<T>(source: string, work: () => Promise<T>): Promise<T> {
  const session = await auth();
  return withAuditContext({
    actorType: session?.user?.id ? "USER" : "ANONYMOUS",
    actorUserId: session?.user?.id,
    source,
  }, work);
}
