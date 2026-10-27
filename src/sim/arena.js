export const ARENA = { width: 1600, height: 900 };

// загортання координати в межах арени
export function wrap(value, max) {
	return ((value % max) + max) % max;
}
