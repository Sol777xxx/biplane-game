import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { Game } from "../sim/game.js";
import { Bullet } from "../sim/objects.js";
import { TICK_DT } from "../sim/time.ts";

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
		const me = game.addPlayer("a");
		const seen = record(game, ["fired"]);
		me.plane.cooldown = 0;
		const bullet = me.plane.fire();
		assert.ok(bullet);
		assert.equal(seen.length, 1);
		assert.equal(seen[0].detail.by, me.plane);
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
		game.step(TICK_DT);
		assert.equal(seen.length, 1);
		assert.equal(seen[0].detail.target, obstacle);
	});

	it("scored і exploded: знищена хмарка", () => {
		const game = new Game();
		const me = game.addPlayer("a");
		const seen = record(game, ["scored", "exploded"]);
		const [obstacle] = game.world.ofKind("obstacle");
		obstacle.takeDamage(1e9, me.plane);
		game.step(TICK_DT);
		const scored = seen.find((s) => s.type === "scored");
		const exploded = seen.find((s) => s.type === "exploded");
		assert.equal(scored.detail.delta, Math.round(obstacle.radius));
		assert.equal(scored.detail.total, me.score);
		assert.equal(scored.detail.player, "a");
		assert.equal(exploded.detail.kind, "obstacle");
	});

	it("сим не імпортує audio і hud", () => {
		const dir = new URL("../sim/", import.meta.url);
		for (const file of readdirSync(dir)) {
			const src = readFileSync(new URL(file, dir), "utf8");
			assert.doesNotMatch(src, /import[^;]*(audio|hud)/i, file);
		}
	});
});
