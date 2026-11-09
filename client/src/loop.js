export function createLoop({
	update,
	render,
	onStats,
	step = 1 / 60, // крок симуляції/с
	maxFrame = 0.25, // ліміт кадру проти «спіралі смерті»
	mode = "fixed", // "fixed" | "variable"
	driver = "raf", // "raf" | "interval"
}) {
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

	function frame(nowMs) {
		if (!running) return;
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

		if (driver === "raf") handle = requestAnimationFrame(frame);
	}

	return {
		start() {
			if (running) return;
			running = true;
			last = performance.now() / 1000;
			if (driver === "interval") {
				handle = setInterval(() => frame(performance.now()), 16);
			} else {
				handle = requestAnimationFrame(frame);
			}
		},
		stop() {
			running = false;
			if (driver === "interval") clearInterval(handle);
			else cancelAnimationFrame(handle);
		},
	};
}
