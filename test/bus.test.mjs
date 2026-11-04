import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { Game } from "../src/sim/game.js";
import { Bullet } from "../src/sim/objects.js";

function record(game, types) {
	const seen = [];
	for (const type of types) {
		game.world.bus.addEventListener(type, (e) =>
			seen.push({ type, detail: e.detail }),
		);
	}
	return seen;
}

describe("шина подій світу", () => {
	it("fired: постріл кидає подію", () => {
		const game = new Game();
		const seen = record(game, ["fired"]);
		game.plane.cooldown = 0;
		const bullet = game.plane.fire();
		assert.ok(bullet);
		assert.equal(seen.length, 1);
		assert.equal(seen[0].detail.by, game.plane);
	});

	it("hit: влучання кулі в хмарку", () => {
		const game = new Game();
		const seen = record(game, ["hit"]);
		const [obstacle] = game.world.ofKind("obstacle");
		game.world.spawn(
			new Bullet({
				owner: null,
				x: obstacle.pos.x,
				y: obstacle.pos.y,
				vx: 0,
				vy: 0,
			}),
		);
		game.step(1 / 60, {});
		assert.equal(seen.length, 1);
		assert.equal(seen[0].detail.target, obstacle);
	});

	it("scored і exploded: знищена хмарка", () => {
		const game = new Game();
		const seen = record(game, ["scored", "exploded"]);
		const [obstacle] = game.world.ofKind("obstacle");
		obstacle.takeDamage(1e9, game.plane);
		game.step(1 / 60, {});
		const scored = seen.find((s) => s.type === "scored");
		const exploded = seen.find((s) => s.type === "exploded");
		assert.equal(scored.detail.delta, Math.round(obstacle.radius));
		assert.equal(scored.detail.total, game.score);
		assert.equal(exploded.detail.kind, "obstacle");
	});

	it("сим не імпортує audio і hud", () => {
		const dir = new URL("../src/sim/", import.meta.url);
		for (const file of readdirSync(dir)) {
			const src = readFileSync(new URL(file, dir), "utf8");
			assert.doesNotMatch(src, /import[^;]*(audio|hud)/i, file);
		}
	});
});
