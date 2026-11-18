import type { Ctx } from "../canvas.ts";

export type PilotId = "mushroom" | "alien" | "empty";

// (0, 0) — центр кабіни, герой дивиться праворуч
export interface Pilot {
	readonly id: PilotId;
	readonly name: string;
	draw(ctx: Ctx, time: number): void;
}
