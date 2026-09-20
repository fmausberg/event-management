import { getPrisma } from "@/lib/db/prisma";
import { getEventCapacity } from "@/lib/events/get-event-capacity";
import { AdapterNotImplementedError, AdapterNotRegisteredError } from "@/lib/integrations/errors";
import { getPlatformAdapter } from "@/lib/integrations/registry";
import type { Platform } from "@/lib/integrations/types";

export interface PlatformSyncResult {
  platformEventId: string;
  platform: Platform;
  success: boolean;
  error?: string;
  errorPersistenceFailed?: boolean;
}

// Explicit invocation only. Callers must serialize syncs per event; no scheduler in phase 1.
export async function syncEventCapacity(eventId: string) {
  const capacity = await getEventCapacity(eventId);
  const prisma = getPrisma();
  const mappings = await prisma.platformEvent.findMany({
    where: { eventId, syncStatus: "ACTIVE" },
    orderBy: { id: "asc" },
  });
  const results: PlatformSyncResult[] = [];

  for (const mapping of mappings) {
    const result = { platformEventId: mapping.id, platform: mapping.platform };
    try {
      const adapter = getPlatformAdapter(mapping.platform);
      await adapter.updateAvailability(mapping.externalEventId, capacity.remainingSeats);
      await prisma.platformEvent.update({
        where: { id: mapping.id },
        data: { lastSyncedAt: new Date(), lastError: null },
      });
      results.push({ ...result, success: true });
    } catch (error) {
      // Never persist arbitrary SDK errors: they may contain URLs, credentials or payloads.
      const lastError = error instanceof AdapterNotImplementedError || error instanceof AdapterNotRegisteredError
        ? error.message
        : "Availability synchronization failed.";
      let errorPersistenceFailed = false;
      try {
        await prisma.platformEvent.update({
          where: { id: mapping.id },
          data: { lastError },
        });
      } catch {
        // A failed error write must not prevent remaining platforms from being tried.
        errorPersistenceFailed = true;
      }
      // Keep ACTIVE so transient failures can be retried on the next explicit sync.
      results.push({ ...result, success: false, error: lastError, errorPersistenceFailed });
    }
  }
  return { ...capacity, results };
}
