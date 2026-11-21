import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
	gcStats,
	labelOf,
	selfTime,
	toMarkdown,
	topAllocators,
} from "../../perf/analyze.mjs";

const frame = (functionName, url = "", lineNumber = 0) => ({
	functionName,
	url,
	lineNumber,
});

describe("labelOf", () => {
	it("функція, файл і рядок з одиниці", () => {
		assert.equal(
			labelOf(frame("draw", "http://x/assets/renderer.js?v=1", 41)),
			"draw renderer.js:42",
		);
	});
	it("анонімна й службові", () => {
		assert.equal(labelOf(frame("")), "(anonymous)");
		assert.equal(labelOf(frame("(idle)")), "(idle)");
	});
});

describe("selfTime", () => {
	// 1 root, 2 idle, 3 draw, 4 gc; дельти в мкс: тривалість семпла i це timeDeltas[i + 1]
	const profile = {
		nodes: [
			{ id: 1, callFrame: frame("(root)") },
			{ id: 2, callFrame: frame("(idle)") },
			{ id: 3, callFrame: frame("draw", "r.js", 9) },
			{ id: 4, callFrame: frame("(garbage collector)") },
		],
		samples: [3, 3, 2, 4, 3],
		timeDeltas: [0, 4000, 4000, 8000, 2000],
	};

	it("складає власний час за функціями й відокремлює idle і GC", () => {
		const r = selfTime(profile);
		assert.equal(r.totalMs, 18);
		assert.equal(r.activeMs, 10);
		assert.equal(r.gcMs, 2);
		assert.deepEqual(r.rows, [{ name: "draw r.js:10", selfMs: 8, pct: 80 }]);
	});

	it("порожній профіль не ламається", () => {
		const r = selfTime({ nodes: [], samples: [], timeDeltas: [] });
		assert.deepEqual(r, { totalMs: 0, activeMs: 0, gcMs: 0, rows: [] });
	});
});

describe("topAllocators", () => {
	const profile = {
		head: {
			callFrame: frame("(root)"),
			selfSize: 0,
			children: [
				{
					callFrame: frame("fire", "b.js", 0),
					selfSize: 300,
					children: [{ callFrame: frame("Vector2", "v.js", 4), selfSize: 100 }],
				},
				{ callFrame: frame("fire", "b.js", 0), selfSize: 100, children: [] },
			],
		},
	};

	it("сума по місцях виділення, за спаданням", () => {
		const r = topAllocators(profile);
		assert.equal(r.totalBytes, 500);
		assert.deepEqual(r.rows, [
			{ name: "fire b.js:1", bytes: 400, pct: 80 },
			{ name: "Vector2 v.js:5", bytes: 100, pct: 20 },
		]);
	});
});

describe("gcStats", () => {
	const meta = (pid, name) => ({
		ph: "M",
		name: "process_name",
		pid,
		args: { name },
	});
	const ev = (pid, name, dur, ph = "X") => ({ ph, name, pid, dur });

	it("рахує паузи лише в рендерері з найбільшою кількістю GC", () => {
		const events = [
			meta(1, "Browser"),
			meta(2, "Renderer"),
			meta(3, "Renderer"),
			ev(2, "V8.GCScavenger", 1000),
			ev(2, "V8.GCScavenger", 3000),
			ev(2, "V8.GCCompactor", 12000),
			ev(3, "V8.GCScavenger", 500),
			ev(1, "V8.GCScavenger", 9000),
			ev(2, "V8.GCScavenger", 700, "B"),
			ev(2, "Other", 5000),
		];
		assert.deepEqual(gcStats(events), {
			minor: { count: 2, totalMs: 4, maxMs: 3 },
			major: { count: 1, totalMs: 12, maxMs: 12 },
		});
	});

	it("без подій GC: нулі", () => {
		const zero = { count: 0, totalMs: 0, maxMs: 0 };
		assert.deepEqual(gcStats([]), { minor: zero, major: zero });
	});
});

describe("toMarkdown", () => {
	it("таблиця містить ключові показники", () => {
		const sum = (p50, p99) => ({ n: 10, avg: 1, p50, p95: p99, p99, max: p99 });
		const md = toMarkdown("before", {
			perf: {
				frame: sum(4, 20),
				slowFrames: 3,
				spans: { render: sum(2, 9) },
			},
			gc: {
				minor: { count: 5, totalMs: 10, maxMs: 4 },
				major: { count: 1, totalMs: 12, maxMs: 12 },
			},
			cpu: {
				gcMs: 22,
				activeMs: 300,
				rows: [{ name: "draw r.js:1", selfMs: 80, pct: 26 }],
			},
			heap: { rows: [{ name: "fire b.js:1", bytes: 2048, pct: 50 }] },
			server: { tickMs: { p50: 1, p99: 3 } },
		});
		assert.match(md, /### before/);
		assert.match(md, /4 \/ 20 \/ 20 мс|4 \/ 20 \/ 20/);
		assert.match(md, /Паузи major GC \| 1 шт\., разом 12 мс/);
		assert.match(md, /1\. draw r\.js:1: 80 мс \(26%\)/);
		assert.match(md, /1\. fire b\.js:1: 2 КБ \(50%\)/);
	});
});
