export interface ArenaSize {
	readonly width: number;
	readonly height: number;
}

export const ARENA: ArenaSize = { width: 1600, height: 900 };

// загортання координати в межах арени
export function wrap(value: number, max: number): number {
	return ((value % max) + max) % max;
}

// найкоротша відстань зі знаком від a до b на арені, що загортається
export function wrapDelta(a: number, b: number, max: number): number {
	let d = b - a;
	if (d > max / 2) d -= max;
	else if (d < -max / 2) d += max;
	return d;
}
