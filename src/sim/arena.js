export const ARENA = { width: 1600, height: 900 };

// загортання координати в межах арени
export function wrap(value, max) {
	return ((value % max) + max) % max;
}

// найкоротша відстань зі знаком від a до b на арені, що загортається
export function wrapDelta(a, b, max) {
	let d = b - a;
	if (d > max / 2) d -= max;
	else if (d < -max / 2) d += max;
	return d;
}