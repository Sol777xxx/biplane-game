import { ARENA, wrapDelta } from "./arena.ts";
import type { Vec2 } from "./vector.ts";

// Усе, що потрібно колізії від сутності: центр і радіус.
export interface Circle {
	readonly pos: Vec2;
	readonly radius: number;
}

// чи перетинаються два кола (з урахуванням загортання арени)
export function overlaps(a: Circle, b: Circle): boolean {
	const dx = wrapDelta(a.pos.x, b.pos.x, ARENA.width);
	const dy = wrapDelta(a.pos.y, b.pos.y, ARENA.height);
	const r = a.radius + b.radius;
	return dx * dx + dy * dy <= r * r;
}

// наївний O(n²): повертає пари (a, b); систему можна замінити просторовим хешем.
// Дженерик E: на вході сутності певного типу, на виході пари саме цього типу.
export function findCollisions<E extends Circle & { readonly alive: boolean }>(
	world: Iterable<E>,
): [E, E][] {
	const items: E[] = [];
	for (const e of world) {
		if (e.alive && e.radius > 0) items.push(e);
	}

	const pairs: [E, E][] = [];
	for (let i = 0; i < items.length; i++) {
		const a = items[i];
		if (a === undefined) continue; // noUncheckedIndexedAccess: items[i] може бути undefined
		for (let j = i + 1; j < items.length; j++) {
			const b = items[j];
			if (b === undefined) continue;
			if (overlaps(a, b)) pairs.push([a, b]);
		}
	}
	return pairs;
}
