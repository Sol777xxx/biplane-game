import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { silentLogger } from "../src/logger.js";
import { Match } from "../src/match.js";
import { Room } from "../src/rooms.js";

// мінімальний підроблений годинник
function fakeClock() {
	let t = 0;
	let id = 0;
	const timers = new Map();
	return {
		now: () => t,
		setTimer(fn, ms) {
			timers.set(++id, { at: t + ms, fn });
			return id;
		},
		clearTimer: (key) => timers.delete(key),
		advance(target) {
			for (;;) {
				let best = null;
				for (const [key, timer] of timers) {
					if (!best || timer.at < best.timer.at) best = { key, timer };
				}
				if (!best || best.timer.at > target) break;
				timers.delete(best.key);
				t = Math.max(t, best.timer.at);
				best.timer.fn();
			}
			t = target;
		},
	};
}

const FIRE = { up: false, down: false, left: false, right: false, fire: true };

describe("Match: seq куль", () => {
	it("куля з реального input має його seq, а з повтору клавіш 0", () => {
		const clock = fakeClock();
		const room = new Room({ id: "r", name: "R" });
		const match = new Match({
			room,
			log: silentLogger,
			now: clock.now,
			setTimer: clock.setTimer,
			clearTimer: clock.clearTimer,
			seed: () => 1,
		});
		const snaps = [];
		room.on("snapshot", (s) => snaps.push(s.snapshot));
		room.join({ id: "a", name: "A" });

		room.emit("input", { playerId: "a", seq: 3, keys: FIRE });
		clock.advance(40);
		assert.deepEqual(
			snaps[0].bullets.map((b) => b.seq),
			[3],
		);
		assert.equal(snaps[0].bullets[0].owner, "a");

		// черга порожня, клавіші повторюються: після перезарядки з'являється куля з seq 0
		clock.advance(500);
		const all = new Set(snaps.flatMap((s) => s.bullets.map((b) => b.seq)));
		assert.ok(all.has(0), `seq куль: ${[...all]}`);
		match.dispose();
	});
});
