import { AdapterNotImplementedError } from "../errors";
import { RAUSGEGANGEN } from "./types";

// No credentials, guessed endpoints, HTTP calls, or provider payloads in phase 1.
export function createRausgegangenClient(): never {
  throw new AdapterNotImplementedError(RAUSGEGANGEN);
}
