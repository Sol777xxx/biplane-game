import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RollingStats } from "../src/stats.js";

describe("RollingStats", () => {
	it("порожній: нулі", () => {
		assert.deepEqual(new RollingStats().summary(), {
			n: 0,
			avg: 0,
			p95: 0,
			max: 0,
			jitter: 0,
		});
	});

	it("середнє, максимум, p95, розкид", () => {
		const s = new RollingStats();
		for (let i = 1; i <= 100; i++) s.add(i);
		const r = s.summary();
		assert.equal(r.n, 100);
		assert.equal(r.avg, 50.5);
		assert.equal(r.max, 100);
		assert.equal(r.p95, 95);
		assert.ok(Math.abs(r.jitter - 28.866) < 0.01);
	});

	it("кільце: старі виміри витісняються", () => {
		const s = new RollingStats(3);
		for (const v of [1, 2, 3, 100, 100, 100]) s.add(v);
		const r = s.summary();
		assert.equal(r.n, 3);
		assert.equal(r.avg, 100);
		assert.equal(r.jitter, 0);
	});
});
