import type { PlatformAdapter } from "../platform-adapter";
import { createRausgegangenClient } from "./client";
import { RAUSGEGANGEN } from "./types";

export const rausgegangenAdapter: PlatformAdapter = {
  platform: RAUSGEGANGEN,
  async getBookings() {
    return createRausgegangenClient();
  },
  async updateAvailability() {
    createRausgegangenClient();
  },
};
