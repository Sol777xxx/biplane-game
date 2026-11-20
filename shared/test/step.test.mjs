import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { Game } from "../sim/game.ts";
import { hashGame } from "../sim/hash.ts";
import { createScenario, scriptedInput } from "../sim/scenario.ts";
import { takeSnapshot } from "../sim/snapshot.ts";
import { TICK_DT } from "../sim/time.ts";

describe("детермінізм кроку", () => {
	it("два однакові світи після 300 кроків мають однакові знімки (deep-equal), не лише хеш", () => {
		const a = createScenario({ seed: 7, players: 3 });
		const b = createScenario({ seed: 7, players: 3 });
		for (let i = 0; i < 300; i++) {
			a.step();
			b.step();
		}
		assert.deepEqual(takeSnapshot(a.game), takeSnapshot(b.game));
	});

	it("знімки збігаються на кожній контрольній позначці, а з іншим seed розходяться", () => {
		const a = createScenario({ seed: 3 });
		const b = createScenario({ seed: 3 });
		const other = createScenario({ seed: 4 });
		let diverged = false;
		for (let i = 1; i <= 200; i++) {
			a.step();
			b.step();
			other.step();
			if (i % 40 === 0) {
				assert.deepEqual(
					takeSnapshot(a.game),
					takeSnapshot(b.game),
					`крок ${i}`,
				);
			}
			if (hashGame(a.game) !== hashGame(other.game)) diverged = true;
		}
		assert.equal(diverged, true);
	});

	it("takeSnapshot нічого не міняє: два виклики однакові, хеш гри не змінюється", () => {
		const s = createScenario({ seed: 5 });
		for (let i = 0; i < 100; i++) s.step();
		const before = hashGame(s.game);
		assert.deepEqual(takeSnapshot(s.game), takeSnapshot(s.game));
		assert.equal(hashGame(s.game), before);
	});

	it("порядок ключів в inputs не впливає на результат кроку", () => {
		const ids = ["p0", "p1", "p2"];
		const run = (order) => {
			const game = new Game({}, { seed: 11 });
			for (const id of ids) game.addPlayer(id);
			for (let tick = 0; tick < 300; tick++) {
				const inputs = new Map(
					order.map((id) => [id, scriptedInput(tick + ids.indexOf(id) * 37)]),
				);
				game.step(TICK_DT, inputs);
			}
			return hashGame(game);
		};
		assert.equal(run(ids), run([...ids].reverse()));
		assert.equal(run(ids), run(["p1", "p2", "p0"]));
	});

	it("клієнтський і серверний крок однакові: крок без input нічого не вигадує", () => {
		const a = createScenario({ seed: 9 });
		const b = createScenario({ seed: 9 });
		for (let i = 0; i < 50; i++) {
			a.step();
			b.step();
		}
		a.game.step(TICK_DT, new Map());
		b.game.step(TICK_DT, new Map());
		assert.deepEqual(takeSnapshot(a.game), takeSnapshot(b.game));
		assert.equal(a.game.tick, 51);
	});
});
