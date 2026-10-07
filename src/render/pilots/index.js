
import { empty } from "./empty.js";

export const PILOTS = { empty,};
export const DEFAULT_PILOT = "empty";

export function getPilot(id) {
  return PILOTS[id] ?? PILOTS[DEFAULT_PILOT];
}