import { AdapterNotImplementedError } from "../errors";
import { EVENTBRITE } from "./types";

// No credentials, guessed endpoints, HTTP calls, or provider payloads in phase 1.
export function createEventbriteClient(): never {
  throw new AdapterNotImplementedError(EVENTBRITE);
}
