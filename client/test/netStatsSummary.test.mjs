import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarize } from "../src/netStats.js";

describe("summarize", () => {
	it("порожній список: нулі", () => {
		assert.deepEqual(summarize([]), { n: 0, mean: 0, p95: 0, max: 0 });
	});

	it("середнє, p95, максимум; вхід не змінюється", () => {
		const values = Array.from({ length: 100 }, (_, i) => 100 - i);
		const r = summarize(values);
		assert.deepEqual(r, { n: 100, mean: 50.5, p95: 95, max: 100 });
		assert.equal(values[0], 100);
	});

	it("округлення до сотих", () => {
		assert.deepEqual(summarize([0.001, 0.002]), {
			n: 2,
			mean: 0,
			p95: 0,
			max: 0,
		});
		assert.equal(summarize([1.236]).max, 1.24);
	});
});
