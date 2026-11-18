import type { Pilot } from "./types.ts";

export const empty: Pilot = {
	id: "empty",
	name: "Без пілота",
	draw() {},
};
