import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import { createLoop } from "../src/loop.ts";

const realNow = performance.now;
const realRaf = globalThis.requestAnimationFrame;
const realCancel = globalThis.cancelAnimationFrame;

afterEach(() => {
	vi.useRealTimers();
	performance.now = realNow;
	globalThis.requestAnimationFrame = realRaf;
	globalThis.cancelAnimationFrame = realCancel;
});

const near = (actual, expected, eps = 1e-9) =>
	assert.ok(Math.abs(actual - expected) <= eps, `${actual} ≉ ${expected}`);

// Ручний годинник і ручний requestAnimationFrame: кадром керує тест, а не браузер.
function harness(options) {
	const h = { t: 0, queued: null, registered: 0, cancelled: 0 };
	performance.now = () => h.t;
	globalThis.requestAnimationFrame = (fn) => {
		h.queued = fn;
		h.registered++;
		return 1;
	};
	globalThis.cancelAnimationFrame = () => {
		h.queued = null;
		h.cancelled++;
	};
	h.updates = [];
	h.alphas = [];
	h.stats = [];
	h.loop = createLoop({
		update: (dt) => h.updates.push(dt),
		render: (alpha) => h.alphas.push(alpha),
		onStats: (s) => h.stats.push(s),
		...options,
	});
	// пройшло ms мілісекунд: браузер викликає колбек кадру
	h.frame = (ms) => {
		h.t += ms;
		const fn = h.queued;
		h.queued = null;
		fn?.(h.t);
	};
	return h;
}

describe("createLoop: фіксований крок", () => {
	it("акумулятор: кадр 250 мс при кроці 100 мс дає 2 кроки й alpha 0.5", () => {
		const h = harness({ step: 0.1, maxFrame: 1 });
		h.loop.start();
		h.frame(250);
		assert.deepEqual(h.updates, [0.1, 0.1]);
		assert.equal(h.alphas.length, 1);
		near(h.alphas[0], 0.5);
	});

	it("залишок накопичується між кадрами: 3 кадри по 20 мс при кроці 50 мс дають 1 крок", () => {
		const h = harness({ step: 0.05, maxFrame: 1 });
		h.loop.start();
		h.frame(20);
		h.frame(20);
		assert.equal(h.updates.length, 0);
		h.frame(20);
		assert.equal(h.updates.length, 1);
		assert.equal(h.alphas.length, 3); // render щокадру
		near(h.alphas[2], 0.2);
	});

	it("кожен крок має рівно dt = step, незалежно від довжини кадру", () => {
		const h = harness({ step: 0.05, maxFrame: 1 });
		h.loop.start();
		for (const ms of [7, 120, 33, 90]) h.frame(ms);
		assert.ok(h.updates.length > 0);
		for (const dt of h.updates) assert.equal(dt, 0.05);
	});

	it("maxFrame: завислий кадр у 5 с не запускає сотні кроків (спіраль смерті)", () => {
		const h = harness({ step: 0.1, maxFrame: 0.25 });
		h.loop.start();
		h.frame(5000);
		assert.equal(h.updates.length, 2);
	});

	it("alpha завжди в [0, 1)", () => {
		const h = harness({ step: 0.05, maxFrame: 1 });
		h.loop.start();
		for (const ms of [3, 17, 49, 50, 51, 99, 1]) h.frame(ms);
		for (const a of h.alphas) assert.ok(a >= 0 && a < 1, `alpha ${a}`);
	});
});

describe("createLoop: змінний крок", () => {
	it("один update на кадр із реальним dt і alpha = 1", () => {
		const h = harness({ mode: "variable", maxFrame: 0.25 });
		h.loop.start();
		h.frame(30);
		h.frame(10);
		near(h.updates[0], 0.03);
		near(h.updates[1], 0.01);
		assert.deepEqual(h.alphas, [1, 1]);
	});

	it("dt обмежений maxFrame", () => {
		const h = harness({ mode: "variable", maxFrame: 0.25 });
		h.loop.start();
		h.frame(3000);
		assert.deepEqual(h.updates, [0.25]);
	});
});

describe("createLoop: статистика, start і stop", () => {
	it("onStats раз на секунду: кадри, кроки, мін/макс, нульовий розкид при рівних кадрах", () => {
		const h = harness({ step: 0.125, maxFrame: 1 });
		h.loop.start();
		for (let i = 0; i < 7; i++) h.frame(125);
		assert.equal(h.stats.length, 0);
		h.frame(125); // 8 × 125 мс = рівно 1 с
		assert.equal(h.stats.length, 1);
		const s = h.stats[0];
		assert.equal(s.framesPerSec, 8);
		assert.equal(s.stepsPerSec, 8);
		assert.equal(s.minMs, 125);
		assert.equal(s.maxMs, 125);
		assert.equal(s.frameMs, 125);
		near(s.jitterMs, 0, 1e-6);
	});

	it("статистика скидається після звіту", () => {
		const h = harness({ step: 0.125, maxFrame: 1 });
		h.loop.start();
		for (let i = 0; i < 16; i++) h.frame(125);
		assert.equal(h.stats.length, 2);
		assert.equal(h.stats[1].framesPerSec, 8);
	});

	it("розкид відображає нерівні кадри", () => {
		const h = harness({ step: 0.125, maxFrame: 1 });
		h.loop.start();
		for (const ms of [50, 200, 50, 200, 50, 200, 50, 200]) h.frame(ms);
		assert.equal(h.stats.length, 1);
		near(h.stats[0].minMs, 50, 1e-6);
		near(h.stats[0].maxMs, 200, 1e-6);
		near(h.stats[0].jitterMs, 75, 1e-6);
	});

	it("повторний start не плодить другу петлю", () => {
		const h = harness({ step: 0.1 });
		h.loop.start();
		h.loop.start();
		assert.equal(h.registered, 1);
	});

	it("stop скасовує кадр, і запізнілий колбек нічого не робить", () => {
		const h = harness({ step: 0.1, maxFrame: 1 });
		h.loop.start();
		const late = h.queued;
		h.loop.stop();
		assert.equal(h.cancelled, 1);
		late(500);
		assert.equal(h.updates.length, 0);
		assert.equal(h.alphas.length, 0);
	});

	it("після stop можна знову start", () => {
		const h = harness({ step: 0.1, maxFrame: 1 });
		h.loop.start();
		h.frame(100);
		h.loop.stop();
		h.loop.start();
		h.frame(100);
		assert.equal(h.updates.length, 2);
	});
});

describe("createLoop: driver interval на фейкових таймерах", () => {
	it("за 1 с інтервалів по 16 мс: 62 кадри, 59 кроків по 1/60, потім stop", () => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
		const t0 = Date.now();
		performance.now = () => Date.now() - t0;
		const updates = [];
		let renders = 0;
		const loop = createLoop({
			update: (dt) => updates.push(dt),
			render: () => renders++,
			driver: "interval",
			step: 1 / 60,
		});
		loop.start();
		vi.advanceTimersByTime(1000);
		assert.equal(renders, 62);
		assert.equal(updates.length, 59);
		for (const dt of updates) assert.equal(dt, 1 / 60);
		loop.stop();
		vi.advanceTimersByTime(1000);
		assert.equal(renders, 62);
	});
});
