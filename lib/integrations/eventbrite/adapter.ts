import type { PlatformAdapter } from "../platform-adapter";
import { createEventbriteClient } from "./client";
import { EVENTBRITE } from "./types";

export const eventbriteAdapter: PlatformAdapter = {
  platform: EVENTBRITE,
  async getBookings() {
    return createEventbriteClient();
  },
  async updateAvailability() {
    createEventbriteClient();
  },
};
