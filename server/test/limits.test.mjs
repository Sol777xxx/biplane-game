import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TokenBucket } from "../src/limits.js";

function bucket(capacity, refillPerSec) {
	const clock = { now: 0 };
	return {
		clock,
		b: new TokenBucket({ capacity, refillPerSec, now: () => clock.now }),
	};
}

describe("TokenBucket", () => {
	it("дозволяє сплеск до capacity, далі відмовляє", () => {
		const { b } = bucket(3, 1);
		assert.deepEqual(
			[b.take(), b.take(), b.take(), b.take()],
			[true, true, true, false],
		);
	});

	it("поповнюється з часом, у тому числі дробово", () => {
		const { b, clock } = bucket(2, 2); // 2 токени за секунду
		b.take();
		b.take();
		assert.equal(b.take(), false);
		clock.now += 250; // 0.5 токена
		assert.equal(b.take(), false);
		clock.now += 250; // разом 1 токен
		assert.equal(b.take(), true);
		assert.equal(b.take(), false);
	});

	it("довге простоювання не накопичує більше capacity", () => {
		const { b, clock } = bucket(2, 10);
		clock.now += 3_600_000;
		assert.deepEqual([b.take(), b.take(), b.take()], [true, true, false]);
	});

	it("cost більший за наявне: відмова без списання", () => {
		const { b } = bucket(5, 1);
		assert.equal(b.take(10), false);
		assert.equal(b.take(5), true);
	});

	it("некоректні параметри відхиляються", () => {
		assert.throws(
			() => new TokenBucket({ capacity: 0, refillPerSec: 1 }),
			RangeError,
		);
		assert.throws(
			() => new TokenBucket({ capacity: 1, refillPerSec: 0 }),
			RangeError,
		);
		assert.throws(
			() => new TokenBucket({ capacity: Number.NaN, refillPerSec: 1 }),
			RangeError,
		);
	});
});
