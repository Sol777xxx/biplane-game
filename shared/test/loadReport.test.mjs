import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
	capacity,
	failure,
	holds,
	renderChart,
	summarizeLevel,
	TICK_BUDGET_MS,
	toMarkdown,
} from "../../perf/loadreport.mjs";

const room = (over = {}) => ({
	id: "r",
	running: true,
	players: 8,
	ticks: 600,
	skipped: 0,
	overruns: 0,
	tickMs: {
		n: 300,
		avg: 0.4,
		p50: 0.4,
		p95: 0.5,
		p99: 0.6,
		max: 1.2,
		jitter: 0.1,
	},
	intervalMs: { p99: 35 },
	lateMs: { p99: 2 },
	...over,
});
const stats = (rooms) => ({
	rooms,
	eventLoop: { utilization: 0.25, delayMs: { p50: 0.1, p99: 3.456, max: 9 } },
	memory: { rss: 100 * 1048576, heapUsed: 1 },
});
const level = (clients, over = {}) => ({
	clients,
	rooms: 1,
	tickMs: { p50: 0.4, p99: 0.6, max: 1.2 },
	simLoad: 1,
	skipped: 0,
	ticks: 1000,
	generatorLagMs: 1,
	loopUtilization: 0.1,
	lateP99: 2,
	rssMb: 100,
	...over,
});

describe("summarizeLevel", () => {
	it("бере найгіршу кімнату й ігнорує зупинені та порожні", () => {
		const s = summarizeLevel({
			clients: 16,
			seconds: 10,
			snapshots: 4800,
			generatorLagMs: 0.04,
			stats: stats([
				room({ tickMs: { avg: 0.4, p50: 0.3, p99: 2, max: 3 } }),
				room({ tickMs: { avg: 0.4, p50: 0.5, p99: 9, max: 12 } }),
				room({ running: false, tickMs: { avg: 9, p50: 9, p99: 99, max: 99 } }),
				room({ players: 0, tickMs: { avg: 9, p50: 9, p99: 99, max: 99 } }),
			]),
		});
		assert.equal(s.rooms, 2);
		assert.deepEqual(s.tickMs, { p50: 0.5, p99: 9, max: 12 });
		assert.equal(s.snapshotsPerClientPerSec, 30);
		assert.equal(s.loopDelayP99, 3.5);
		assert.equal(s.rssMb, 100);
		assert.equal(s.ticks, 1200);
		// 2 кімнати × 0,4 мс × 30 тіків/с = 24 мс з 1000 мс = 2,4%
		assert.equal(s.simLoad, 2.4);
	});

	it("без eventLoop (старий сервер): null", () => {
		const s = summarizeLevel({
			clients: 8,
			seconds: 1,
			snapshots: 0,
			generatorLagMs: 0,
			stats: { rooms: [room()], eventLoop: null, memory: { rss: 0 } },
		});
		assert.equal(s.loopUtilization, null);
	});
});

describe("failure / holds / capacity", () => {
	it("тримає, коли тік у бюджеті", () => {
		assert.equal(failure(level(8)), null);
		assert.equal(holds(level(8)), true);
	});

	it("межа бюджету: рівно 33,3 мс ще тримає, більше ні", () => {
		assert.equal(
			holds(level(8, { tickMs: { p50: 1, p99: TICK_BUDGET_MS, max: 40 } })),
			true,
		);
		assert.match(
			failure(level(8, { tickMs: { p50: 1, p99: 34, max: 40 } })),
			/тік p99 34 мс/,
		);
	});

	it("поодинокий пропуск терпимий, систематичний ні", () => {
		assert.equal(holds(level(8, { skipped: 5, ticks: 1000 })), true);
		assert.match(
			failure(level(8, { skipped: 20, ticks: 1000 })),
			/пропущено 20 тіків з 1000/,
		);
	});

	it("цикл подій сервера ≥ 90% це насичення, навіть якщо тік короткий", () => {
		assert.match(
			failure(level(512, { loopUtilization: 0.93 })),
			/цикл подій сервера зайнятий на 93%/,
		);
		assert.equal(holds(level(512, { loopUtilization: 0.89 })), true);
		assert.equal(holds(level(8, { loopUtilization: null })), true);
	});

	it("відстаючий генератор робить результат недостовірним", () => {
		assert.match(failure(level(8, { generatorLagMs: 25 })), /генератор/);
	});

	it("ємність: останній рівень до першого, що не тримає", () => {
		const bad = level(128, { tickMs: { p50: 5, p99: 50, max: 60 } });
		assert.deepEqual(
			capacity([level(8), level(32), level(64), bad, level(256)]),
			{
				capacity: 64,
				failedAt: 128,
				reason: failure(bad),
			},
		);
	});

	it("усе тримає: межу не знайдено", () => {
		assert.deepEqual(capacity([level(8), level(32)]), {
			capacity: 32,
			failedAt: null,
			reason: null,
		});
	});

	it("перший рівень не тримає: ємність 0", () => {
		const r = capacity([level(8, { generatorLagMs: 99 })]);
		assert.equal(r.capacity, 0);
		assert.equal(r.failedAt, 8);
	});
});

describe("toMarkdown і renderChart", () => {
	const levels = [
		level(8),
		level(32),
		level(64, { tickMs: { p50: 9, p99: 40, max: 50 } }),
	];

	it("таблиця називає ємність і причину", () => {
		const md = toMarkdown("before", levels);
		assert.match(md, /### before/);
		assert.match(md, /\| 32 \| 1 \|/);
		assert.match(md, /Ємність N = 32 клієнтів; на 64 не тримає: тік p99 40 мс/);
	});

	it("таблиця без межі: ємність оцінена знизу", () => {
		assert.match(toMarkdown("x", [level(8)]), /не досягнута до 8 клієнтів/);
	});

	it("графік це валідний SVG із двома серіями й лінією бюджету", () => {
		const svg = renderChart(levels, { title: "Тест <&>" });
		assert.match(svg, /^<svg [^>]*viewBox/);
		assert.equal((svg.match(/<polyline/g) ?? []).length, 2);
		assert.equal((svg.match(/<circle/g) ?? []).length, 6);
		assert.match(svg, /stroke-dasharray/);
		assert.match(svg, /бюджет 33\.3 мс/);
		assert.match(svg, /Тест &lt;&amp;>/); // заголовок екранується
		assert.ok(!/NaN|undefined/.test(svg));
	});

	it("один рівень не ламає графік", () => {
		const svg = renderChart([level(8)]);
		assert.ok(!/NaN|undefined/.test(svg));
	});
});
