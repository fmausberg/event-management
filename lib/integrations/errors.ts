import type { Platform } from "./types";

export class AdapterNotImplementedError extends Error {
  constructor(platform: Platform) {
    super(`${platform}: Not implemented`);
    this.name = "AdapterNotImplementedError";
  }
}

export class AdapterNotRegisteredError extends Error {
  constructor(platform: Platform) {
    super(`${platform}: No adapter registered`);
    this.name = "AdapterNotRegisteredError";
  }
}
