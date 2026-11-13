import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { silentLogger } from "../src/logger.js";
import { Match } from "../src/match.js";
import { Room } from "../src/rooms.js";

// підроблений годинник: advance(ms) запускає таймери за порядком часу
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

const KEYS = { up: false, down: false, left: false, right: true, fire: false };

function setup() {
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
	room.join({ id: "a", name: "A" });
	return { clock, room, match };
}

describe("Match: лічильники input", () => {
	it("гравець, який ще нічого не надсилав, повторів не накопичує", () => {
		const { clock, match } = setup();
		clock.advance(140);
		assert.deepEqual(match.stats().inputs, { repeated: 0, dropped: 0 });
	});

	it("порожня черга після input: кожен тік це повтор", () => {
		const { clock, room, match } = setup();
		room.emit("input", { playerId: "a", seq: 1, keys: KEYS });
		clock.advance(140); // 4 тіки: перший бере input, решта повторюють
		assert.deepEqual(match.stats().inputs, { repeated: 3, dropped: 0 });
	});

	it("переповнення черги: найстаріші відкидаються й рахуються", () => {
		const { clock, room, match } = setup();
		for (let seq = 1; seq <= 10; seq++) {
			room.emit("input", { playerId: "a", seq, keys: KEYS });
		}
		clock.advance(140); // 4 тіки з'їдають 4 input, що лишились
		assert.deepEqual(match.stats().inputs, { repeated: 0, dropped: 6 });
	});
});
