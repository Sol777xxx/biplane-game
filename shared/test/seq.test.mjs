import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Game } from "../sim/game.js";
import { takeSnapshot } from "../sim/snapshot.js";
import { TICK_DT } from "../sim/time.js";

const FIRE = { up: false, down: false, left: false, right: false, fire: true };

function setup() {
	const game = new Game({ obstacles: 0 }, { seed: 1 });
	const a = game.addPlayer("a");
	a.plane.pos.set(200, 450); // далеко від країв: куля не вилетить за арену
	a.plane.prevPos.set(200, 450);
	return game;
}

const seqs = (game) => takeSnapshot(game).bullets.map((b) => b.seq);

describe("seq у кулях", () => {
	it("куля несе seq input, який її випустив", () => {
		const game = setup();
		game.step(TICK_DT, new Map([["a", { ...FIRE, seq: 7 }]]));
		assert.deepEqual(seqs(game), [7]);
	});

	it("input без seq (повтор клавіш) дає seq 0", () => {
		const game = setup();
		game.step(TICK_DT, new Map([["a", FIRE]]));
		assert.deepEqual(seqs(game), [0]);
	});

	it("кожна куля має seq свого кроку", () => {
		const game = setup();
		game.step(TICK_DT, new Map([["a", { ...FIRE, seq: 7 }]]));
		for (let i = 0; i < 9; i++) game.step(TICK_DT, new Map([["a", FIRE]]));
		assert.deepEqual(seqs(game), [7, 0]);
	});
});
