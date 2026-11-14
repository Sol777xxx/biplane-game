import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Game } from "../sim/game.js";
import { createScenario } from "../sim/scenario.js";
import { eventToWire, takeSnapshot } from "../sim/snapshot.js";
import { TICK_DT } from "../sim/time.ts";

const twoDecimals = (v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;

describe("takeSnapshot", () => {
	it("форма: усі розділи, tick, гравці, кораблі, хмарки", () => {
		const game = new Game({ obstacles: 3 }, { seed: 1 });
		game.addPlayer("a");
		game.addPlayer("b");
		const snap = takeSnapshot(game);
		assert.equal(snap.tick, 0);
		assert.deepEqual(
			snap.players.map((p) => p.id),
			["a", "b"],
		);
		assert.equal(snap.ships.length, 2);
		assert.equal(snap.obstacles.length, 3);
		assert.deepEqual(snap.bullets, []);
		assert.deepEqual(snap.pickups, []);
		assert.equal(snap.ships[0].player, "a");
		assert.ok(snap.ships[0].shield > 0);
	});

	it("переживає JSON без змін", () => {
		const { game, step } = createScenario({ seed: 3 });
		for (let i = 0; i < 100; i++) step();
		const snap = takeSnapshot(game);
		assert.deepEqual(JSON.parse(JSON.stringify(snap)), snap);
	});

	it("координати округлені до 0.01", () => {
		const { game, step } = createScenario({ seed: 4 });
		for (let i = 0; i < 100; i++) step();
		const snap = takeSnapshot(game);
		for (const s of snap.ships) {
			for (const key of ["x", "y", "vx", "vy"]) assert.ok(twoDecimals(s[key]));
		}
		for (const o of snap.obstacles) {
			for (const key of ["x", "y", "vx", "vy"]) assert.ok(twoDecimals(o[key]));
		}
	});

	it("загиблого корабля в знімку немає, гравець лишається", () => {
		const game = new Game({ obstacles: 0 });
		const a = game.addPlayer("a");
		game.addPlayer("b");
		a.plane.effects.shield = 0;
		a.plane.takeDamage(1e9);
		game.step(TICK_DT);
		const snap = takeSnapshot(game);
		assert.deepEqual(
			snap.ships.map((s) => s.player),
			["b"],
		);
		assert.equal(snap.players.length, 2);
		assert.equal(snap.players[0].deaths, 1);
	});

	it("куля знає свого власника", () => {
		const game = new Game({ obstacles: 0 });
		const a = game.addPlayer("a");
		a.plane.cooldown = 0;
		a.plane.fire();
		const snap = takeSnapshot(game);
		assert.equal(snap.bullets.length, 1);
		assert.equal(snap.bullets[0].owner, "a");
	});

	it("однакові симуляції дають однакові знімки", () => {
		const a = createScenario({ seed: 9 });
		const b = createScenario({ seed: 9 });
		for (let i = 0; i < 200; i++) {
			a.step();
			b.step();
		}
		assert.deepEqual(takeSnapshot(a.game), takeSnapshot(b.game));
	});
});

describe("eventToWire", () => {
	it("постріл і підбір", () => {
		assert.deepEqual(
			eventToWire("fired", { by: { playerId: "a" }, at: { x: 10.4, y: 20.6 } }),
			{ type: "fired", player: "a", x: 10, y: 21 },
		);
		assert.deepEqual(eventToWire("pickup", { type: "rapid", player: "b" }), {
			type: "pickup",
			player: "b",
			pickup: "rapid",
		});
	});

	it("невідомий тип дає null", () => {
		assert.equal(eventToWire("dance", {}), null);
	});
});
