import { alien } from "./alien.ts";
import { empty } from "./empty.ts";
import { mushroom } from "./mushroom.ts";
import type { Pilot, PilotId } from "./types.ts";

export type { Pilot, PilotId };

// реєстр героїв: Record вимагає запис для КОЖНОГО PilotId
export const PILOTS: Readonly<Record<PilotId, Pilot>> = {
	mushroom,
	alien,
	empty,
};
export const PILOT_IDS: readonly PilotId[] = ["mushroom", "alien", "empty"];
export const DEFAULT_PILOT: PilotId = "empty";

// id може прийти звідки завгодно (localStorage), тому це guard, а не приведення типу
export const isPilotId = (id: unknown): id is PilotId =>
	typeof id === "string" && PILOT_IDS.some((p) => p === id);

export function getPilot(id: unknown): Pilot {
	return PILOTS[isPilotId(id) ? id : DEFAULT_PILOT];
}
