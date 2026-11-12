import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { hashGame } from "../sim/hash.js";
import { mulberry32 } from "../sim/random.js";
import { createScenario, runScenario } from "../sim/scenario.js";

describe("детермінізм", () => {
	it("mulberry32: той самий seed, та сама послідовність", () => {
		const a = mulberry32(42);
		const b = mulberry32(42);
		for (let i = 0; i < 100; i++) assert.equal(a(), b());
		assert.notEqual(mulberry32(1)(), mulberry32(2)());
	});

	it("однаковий seed і input: однаковий хеш після 1000 кроків", () => {
		const h = runScenario({ seed: 1 });
		console.log(`hash (1000 кроків, seed 1): ${h}`);
		assert.match(h, /^[0-9a-f]{8}$/);
		assert.equal(runScenario({ seed: 1 }), h);
	});

	it("інший seed або інша кількість гравців: інший хеш", () => {
		const base = runScenario({ seed: 1 });
		assert.notEqual(runScenario({ seed: 2 }), base);
		assert.notEqual(runScenario({ seed: 1, players: 1 }), base);
	});

	it("дві симуляції збігаються на кожному кроці", () => {
		const a = createScenario({ seed: 5 });
		const b = createScenario({ seed: 5 });
		for (let i = 0; i < 600; i++) {
			a.step();
			b.step();
			assert.equal(hashGame(a.game), hashGame(b.game), `крок ${i + 1}`);
		}
	});

	it("sim не викликає Math.random, Date.now і performance.now", () => {
		const boom = (name) => () => {
			throw new Error(`${name} у sim`);
		};
		const mocks = [
			mock.method(Math, "random", boom("Math.random")),
			mock.method(Date, "now", boom("Date.now")),
			mock.method(performance, "now", boom("performance.now")),
		];
		try {
			runScenario({ ticks: 300 });
		} finally {
			for (const m of mocks) m.mock.restore();
		}
	});
});
