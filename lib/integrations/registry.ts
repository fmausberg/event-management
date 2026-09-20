import { AdapterNotRegisteredError } from "./errors";
import { eventbriteAdapter } from "./eventbrite/adapter";
import { rausgegangenAdapter } from "./rausgegangen/adapter";
import type { PlatformAdapter } from "./platform-adapter";
import type { Platform } from "./types";

const adapters = new Map<Platform, PlatformAdapter>([
  [eventbriteAdapter.platform, eventbriteAdapter],
  [rausgegangenAdapter.platform, rausgegangenAdapter],
]);

export function getPlatformAdapter(platform: Platform): PlatformAdapter {
  const adapter = adapters.get(platform);
  if (!adapter) throw new AdapterNotRegisteredError(platform);
  return adapter;
}
