// Спільні типи й допоміжне для малювання на canvas.
export type Ctx = CanvasRenderingContext2D;

// 2D-контекст або зрозуміла помилка (getContext повертає null, якщо контекст недоступний)
export function context2d(canvas: HTMLCanvasElement): Ctx {
	const g = canvas.getContext("2d");
	if (!g) throw new Error("canvas 2d недоступний");
	return g;
}
