import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Game } from "biplane-shared/sim/game.js";

describe("shared у сервері", () => {
	it("Game з biplane-shared працює в Node", () => {
		const game = new Game({ obstacles: 0 });
		const startX = game.plane.pos.x;
		for (let i = 0; i < 60; i++) game.step(1 / 60, { right: true });
		assert.ok(game.plane.pos.x > startX);
		assert.equal(game.world.count("obstacle"), 0);
	});
});
