import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Game } from "../sim/game.js";
import { TICK_DT } from "../sim/time.js";

describe("Game: кілька гравців", () => {
	it("addPlayer: корабель у світі, зі щитом", () => {
		const game = new Game({ obstacles: 0 });
		const a = game.addPlayer("a");
		assert.ok(a.plane.alive);
		assert.ok(a.plane.effects.shield > 0);
		assert.equal(game.world.count("biplane"), 1);
	});

	it("той самий id двічі це помилка", () => {
		const game = new Game({ obstacles: 0 });
		game.addPlayer("a");
		assert.throws(() => game.addPlayer("a"));
	});

	it("removePlayer прибирає корабель", () => {
		const game = new Game({ obstacles: 0 });
		game.addPlayer("a");
		game.removePlayer("a");
		game.step(TICK_DT);
		assert.equal(game.world.count("biplane"), 0);
		assert.equal(game.players.size, 0);
	});

	it("очки отримує той, хто збив хмарку", () => {
		const game = new Game({ obstacles: 1 });
		const a = game.addPlayer("a");
		const b = game.addPlayer("b");
		const [obstacle] = game.world.ofKind("obstacle");
		obstacle.takeDamage(1e9, b.plane);
		game.step(TICK_DT);
		assert.equal(a.score, 0);
		assert.equal(b.score, Math.round(obstacle.radius));
		assert.equal(b.destroyed, 1);
	});

	it("загиблий корабель відроджується через ~2 с новим об'єктом", () => {
		const game = new Game({ obstacles: 0 });
		const a = game.addPlayer("a");
		const old = a.plane;
		old.effects.shield = 0;
		old.takeDamage(1e9);
		game.step(TICK_DT);
		assert.equal(a.deaths, 1);
		for (let i = 0; i < 70; i++) game.step(TICK_DT);
		assert.ok(a.plane.alive);
		assert.notEqual(a.plane, old);
		assert.ok(a.plane.effects.shield > 0);
	});

	it("інпути йдуть кораблю свого гравця", () => {
		const game = new Game({ obstacles: 0 });
		const a = game.addPlayer("a");
		const b = game.addPlayer("b");
		game.step(
			TICK_DT,
			new Map([
				["a", { right: true }],
				["b", { left: true }],
			]),
		);
		assert.ok(a.plane.vel.x > 0);
		assert.ok(b.plane.vel.x < 0);
	});
});
