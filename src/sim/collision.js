import { ARENA, wrapDelta } from "./arena.js";

// чи перетинаються два кола (з урахуванням загортання арени)
export function overlaps(a, b) {
	const dx = wrapDelta(a.pos.x, b.pos.x, ARENA.width);
	const dy = wrapDelta(a.pos.y, b.pos.y, ARENA.height);
	const r = a.radius + b.radius;
	return dx * dx + dy * dy <= r * r;
}

// наївний O(n²): повертає пари (a, b); систему можна замінити просторовим хешем
export function findCollisions(world) {
	const items = [];
	for (const e of world) {
		if (e.alive && e.radius > 0) items.push(e);
	}

	const pairs = [];
	for (let i = 0; i < items.length; i++) {
		for (let j = i + 1; j < items.length; j++) {
			if (overlaps(items[i], items[j])) pairs.push([items[i], items[j]]);
		}
	}
	return pairs;
}