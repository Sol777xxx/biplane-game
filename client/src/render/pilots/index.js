import { alien } from "./alien.js";
import { empty } from "./empty.js";
import { mushroom } from "./mushroom.js";

// реєстр героїв
export const PILOTS = { mushroom, alien, empty };
export const DEFAULT_PILOT = "empty";

export function getPilot(id) {
	return PILOTS[id] ?? PILOTS[DEFAULT_PILOT];
}
