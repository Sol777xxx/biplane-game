export interface LoopStats {
	readonly stepsPerSec: number;
	readonly framesPerSec: number;
	readonly frameMs: number;
	readonly minMs: number;
	readonly maxMs: number;
	readonly jitterMs: number;
}

export interface LoopOptions {
	readonly update: (dt: number) => void;
	// alpha: частка кроку для інтерполяції кадрів, 0..1
	readonly render: (alpha: number) => void;
	readonly onStats?: (stats: LoopStats) => void;
	// скільки мс зайняла робота одного кадру (update + render), без очікування наступного
	readonly onFrame?: (workMs: number) => void;
	readonly step?: number; // крок симуляції/с
	readonly maxFrame?: number; // ліміт кадру проти «спіралі смерті»
	readonly mode?: "fixed" | "variable";
	readonly driver?: "raf" | "interval";
}

export function createLoop({
	update,
	render,
	onStats,
	onFrame,
	step = 1 / 60,
	maxFrame = 0.25,
	mode = "fixed",
	driver = "raf",
}: LoopOptions) {
	let handle = 0;
	let running = false;
	let last = 0;
	let accumulator = 0;

	let steps = 0;
	let frames = 0;
	let statsTime = 0;
	let frameMs = 0;
	let minMs = Number.POSITIVE_INFINITY;
	let maxMs = 0;
	let sumMs = 0;
	let sumSqMs = 0;

	function frame(nowMs: number): void {
		if (!running) return;
		const work0 = onFrame ? performance.now() : 0;
		const t = nowMs / 1000;
		const realDelta = t - last;
		last = t;
		frameMs = realDelta * 1000;

		if (mode === "variable") {
			// без акумулятора: один крок на кадр зі змінним dt
			update(Math.min(realDelta, maxFrame));
			steps++;
			render(1);
		} else {
			// обмеження великої дельти (неактивна вкладка, завислий кадр)
			accumulator += Math.min(realDelta, maxFrame);
			while (accumulator >= step) {
				update(step);
				accumulator -= step;
				steps++;
			}
			render(accumulator / step); // alpha для інтерполяції, 0..1
		}
		frames++;

		minMs = Math.min(minMs, frameMs);
		maxMs = Math.max(maxMs, frameMs);
		sumMs += frameMs;
		sumSqMs += frameMs * frameMs;

		statsTime += realDelta;
		if (statsTime >= 1) {
			const mean = sumMs / frames;
			const variance = Math.max(0, sumSqMs / frames - mean * mean);
			onStats?.({
				stepsPerSec: steps / statsTime,
				framesPerSec: frames / statsTime,
				frameMs,
				minMs,
				maxMs,
				jitterMs: Math.sqrt(variance),
			});
			steps = 0;
			frames = 0;
			statsTime = 0;
			minMs = Number.POSITIVE_INFINITY;
			maxMs = 0;
			sumMs = 0;
			sumSqMs = 0;
		}

		onFrame?.(performance.now() - work0);
		if (driver === "raf") handle = requestAnimationFrame(frame);
	}

	return {
		start(): void {
			if (running) return;
			running = true;
			last = performance.now() / 1000;
			if (driver === "interval") {
				handle = setInterval(() => frame(performance.now()), 16);
			} else {
				handle = requestAnimationFrame(frame);
			}
		},
		stop(): void {
			running = false;
			if (driver === "interval") clearInterval(handle);
			else cancelAnimationFrame(handle);
		},
	};
}

export type Loop = ReturnType<typeof createLoop>;
