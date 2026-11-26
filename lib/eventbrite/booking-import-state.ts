// Explicit client-safe view; connection credentials and import claims stay server-side.
export type EventbriteBookingImportSummary = {
  externalEventId: string;
  lastImportedAt: string | null;
  lastError: string | null;
  running: boolean;
};
export type EventbriteBookingImportState = {
  success?: boolean;
  message?: string;
};
