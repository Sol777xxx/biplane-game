import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { createLoop } from "../src/loop.ts";
import { createPerf, FRAME_BUDGET_MS, SPANS } from "../src/perf.ts";

// годинник, яким керує тест
function clock() {
	let t = 0;
	return {
		now: () => t,
		tick: (ms) => {
			t += ms;
		},
	};
}

describe("createPerf", () => {
	it("вимкнений: нічого не пише й dump повертає null", () => {
		const p = createPerf({ enabled: false });
		p.begin("render");
		p.end("render");
		p.frame(100);
		assert.equal(p.enabled, false);
		assert.equal(p.dump(), null);
	});

	it("рахує тривалість спана за годинником", () => {
		const c = clock();
		const p = createPerf({ enabled: true, now: c.now });
		for (const ms of [2, 4, 6]) {
			p.begin("simulate");
			c.tick(ms);
			p.end("simulate");
		}
		const s = p.dump().spans.simulate;
		assert.equal(s.n, 3);
		assert.equal(s.avg, 4);
		assert.equal(s.p50, 4);
		assert.equal(s.max, 6);
		assert.equal(p.dump().spans.render.n, 0);
	});

	it("p50, p95, p99 за nearest-rank", () => {
		const p = createPerf({ enabled: true });
		for (let i = 1; i <= 100; i++) p.frame(i);
		const f = p.dump().frame;
		assert.equal(f.n, 100);
		assert.equal(f.p50, 50);
		assert.equal(f.p95, 95);
		assert.equal(f.p99, 99);
		assert.equal(f.max, 100);
	});

	it("повільні кадри: лише довші за бюджет 16.7 мс", () => {
		const p = createPerf({ enabled: true });
		for (const ms of [1, FRAME_BUDGET_MS, FRAME_BUDGET_MS + 0.1, 40])
			p.frame(ms);
		assert.equal(p.dump().slowFrames, 2);
	});

	it("кільце: старі виміри витісняються", () => {
		const p = createPerf({ enabled: true, size: 3 });
		for (const v of [100, 100, 100, 1, 2, 3]) p.frame(v);
		const f = p.dump().frame;
		assert.equal(f.n, 3);
		assert.equal(f.max, 3);
	});

	it("reset обнуляє все", () => {
		const p = createPerf({ enabled: true });
		p.frame(50);
		p.begin("render");
		p.end("render");
		p.reset();
		const d = p.dump();
		assert.equal(d.frame.n, 0);
		assert.equal(d.slowFrames, 0);
		for (const s of SPANS) assert.equal(d.spans[s].n, 0);
	});

	describe("marks", () => {
		afterEach(() => {
			performance.clearMarks();
			performance.clearMeasures();
		});

		it("?perf=marks лишає measure для DevTools", () => {
			const p = createPerf({ enabled: true, marks: true });
			p.begin("render");
			p.end("render");
			assert.equal(performance.getEntriesByName("render", "measure").length, 1);
		});

		it("без marks User Timing не чіпається", () => {
			const p = createPerf({ enabled: true, marks: false });
			p.begin("render");
			p.end("render");
			assert.equal(performance.getEntriesByName("render", "measure").length, 0);
		});

		it("буфер User Timing періодично очищається", () => {
			const p = createPerf({ enabled: true, marks: true });
			p.begin("render");
			p.end("render");
			for (let i = 0; i < 600; i++) p.frame(1);
			assert.equal(performance.getEntriesByName("render", "measure").length, 0);
		});
	});
});

describe("loop: onFrame", () => {
	const raf = globalThis.requestAnimationFrame;
	const caf = globalThis.cancelAnimationFrame;
	afterEach(() => {
		globalThis.requestAnimationFrame = raf;
		globalThis.cancelAnimationFrame = caf;
	});

	it("повідомляє про роботу кадру; без onFrame нічого не викликає", () => {
		let cb = null;
		globalThis.requestAnimationFrame = (fn) => {
			cb = fn;
			return 1;
		};
		globalThis.cancelAnimationFrame = () => {};
		const works = [];
		const loop = createLoop({
			step: 1 / 30,
			update: () => {},
			render: () => {},
			onFrame: (ms) => works.push(ms),
		});
		loop.start();
		cb(performance.now() + 16);
		cb(performance.now() + 33);
		loop.stop();
		assert.equal(works.length, 2);
		assert.ok(works.every((ms) => ms >= 0 && Number.isFinite(ms)));
	});
});
