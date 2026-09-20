import type { ExternalBooking, GetBookingsOptions, Platform } from "./types";

export interface PlatformAdapter {
  readonly platform: Platform;
  getBookings(externalEventId: string, options?: GetBookingsOptions): Promise<ExternalBooking[]>;
  updateAvailability(externalEventId: string, availableSeats: number): Promise<void>;
}
