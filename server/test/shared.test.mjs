import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Game } from "biplane-shared/sim/game.js";
import { TICK_DT } from "biplane-shared/sim/time.js";

describe("shared у сервері", () => {
	it("Game з biplane-shared працює в Node", () => {
		const game = new Game({ obstacles: 0 }, { seed: 7 });
		const me = game.addPlayer("a");
		for (let i = 0; i < 30; i++) {
			game.step(TICK_DT, new Map([["a", { right: true }]]));
		}
		assert.ok(me.plane.vel.x > 0);
		assert.equal(game.world.count("obstacle"), 0);
	});
});
