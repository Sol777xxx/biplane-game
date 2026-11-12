import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_ARENA, Game, resolveArena } from "biplane-shared/sim/game.js";

describe("resolveArena", () => {
	it("без шарів дає значення за замовчуванням", () => {
		assert.deepEqual(resolveArena(), DEFAULT_ARENA);
		assert.deepEqual(resolveArena(null, undefined), DEFAULT_ARENA);
	});
	it("пізніший шар перекриває ранній", () => {
		const a = resolveArena({ obstacles: 3, speed: 2 }, { obstacles: 8 });
		assert.equal(a.obstacles, 8);
		assert.equal(a.speed, 2);
	});
	it("обмежує діапазони й ігнорує сміття", () => {
		const a = resolveArena({
			obstacles: 999,
			speed: -5,
			homingChance: "багато",
			pickupEvery: Number.NaN,
		});
		assert.equal(a.obstacles, 20);
		assert.equal(a.speed, 0.2);
		assert.equal(a.homingChance, DEFAULT_ARENA.homingChance);
		assert.equal(a.pickupEvery, DEFAULT_ARENA.pickupEvery);
	});
});

describe("Game з конфігом", () => {
	it("refillEvery визначає, як швидко з'являється нова хмарка", () => {
		const game = new Game({ obstacles: 3, refillEvery: 0.5 });
		for (const o of [...game.world.ofKind("obstacle")]) o.kill();
		for (let i = 0; i < 40; i++) game.step(1 / 60, {}); // ~0.67 с
		assert.equal(game.world.count("obstacle"), 1);
	});
	it("створює вказану кількість хмарок", () => {
		const game = new Game({ obstacles: 8 });
		assert.equal(game.world.count("obstacle"), 8);
	});
	it("speed масштабує швидкість хмарок", () => {
		const slow = new Game({ obstacles: 10, speed: 0.5 });
		for (const o of slow.world.ofKind("obstacle")) {
			assert.ok(o.vel.length() <= 110 * 0.5 + 1e-9);
		}
	});
	it("homingChance 1 робить усі хмарки самонавідними, 0 жодної", () => {
		const all = new Game({ obstacles: 6, homingChance: 1 });
		for (const o of all.world.ofKind("obstacle")) assert.ok(o.has("homing"));
		const none = new Game({ obstacles: 6, homingChance: 0 });
		for (const o of none.world.ofKind("obstacle")) assert.ok(!o.has("homing"));
	});
	it("pickupEvery визначає, коли з'являється зірка", () => {
		const game = new Game({ pickupEvery: 1 });
		for (let i = 0; i < 90; i++) game.step(1 / 60, {});
		assert.equal(game.world.count("pickup"), 1);
	});
});
