import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { silentLogger } from "../src/logger.js";
import { Match } from "../src/match.js";
import { Room } from "../src/rooms.js";

// Підроблений годинник: advance(target) запускає таймери в порядку часу,
// кожен із запізненням late (імітація нерівного таймера ОС).
function fakeClock() {
	let t = 0;
	let seq = 0;
	const timers = new Map();
	return {
		now: () => t,
		setTimer(fn, ms) {
			const id = ++seq;
			timers.set(id, { at: t + ms, fn });
			return id;
		},
		clearTimer(id) {
			timers.delete(id);
		},
		get pending() {
			return timers.size;
		},
		jump(ms) {
			t += ms;
		},
		advance(target, { late = 0 } = {}) {
			for (;;) {
				let best = null;
				for (const [id, timer] of timers) {
					if (!best || timer.at < best.timer.at) best = { id, timer };
				}
				if (!best || best.timer.at + late > target) break;
				timers.delete(best.id);
				t = Math.max(t, best.timer.at + late);
				best.timer.fn();
			}
			t = Math.max(t, target);
		},
	};
}

const NONE = { up: false, down: false, left: false, right: false, fire: false };
const RIGHT = { ...NONE, right: true };
const LEFT = { ...NONE, left: true };

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
	const snaps = [];
	room.on("snapshot", (s) => snaps.push(s));
	return { clock, room, match, snaps };
}

const input = (room, playerId, seq, keys = RIGHT) =>
	room.emit("input", { playerId, seq, keys });
const shipOf = (snap, id) => snap.snapshot.ships.find((s) => s.player === id);

describe("Match: життєвий цикл", () => {
	it("стартує з першим гравцем, зупиняється з останнім, таймерів не лишає", () => {
		const { clock, room, match } = setup();
		assert.equal(match.running, false);
		assert.equal(clock.pending, 0);

		room.join({ id: "a", name: "A" });
		assert.equal(match.running, true);
		assert.equal(clock.pending, 1);

		room.join({ id: "b", name: "B" });
		assert.equal(match.stats().players, 2);

		room.leave("a");
		assert.equal(match.running, true);
		room.leave("b");
		assert.equal(match.running, false);
		assert.equal(clock.pending, 0);
	});

	it("dispose знімає слухача input і зупиняє матч", () => {
		const { clock, room, match } = setup();
		room.join({ id: "a", name: "A" });
		assert.equal(room.listenerCount("input"), 1);
		match.dispose();
		assert.equal(room.listenerCount("input"), 0);
		assert.equal(match.running, false);
		assert.equal(clock.pending, 0);
	});
});

describe("Match: цикл 30 Гц", () => {
	it("секунда часу це 30 тіків, знімок на кожен", () => {
		const { clock, room, snaps } = setup();
		room.join({ id: "a", name: "A" });
		clock.advance(1010);
		assert.equal(snaps.length, 30);
		assert.deepEqual(
			snaps.map((s) => s.snapshot.tick),
			Array.from({ length: 30 }, (_, i) => i + 1),
		);
	});

	it("запізнення таймера не накопичується (на відміну від ланцюжка setInterval)", () => {
		const { clock, room, match } = setup();
		room.join({ id: "a", name: "A" });
		clock.advance(3020, { late: 7 });
		const stats = match.stats();
		assert.equal(stats.ticks, 90);
		assert.equal(stats.skipped, 0);
		assert.ok(stats.lateMs.max < 9, `lateMs.max = ${stats.lateMs.max}`);
		assert.ok(stats.lateMs.avg > 6);
	});

	it("довга пауза: наздоганяє до 5 тіків, решту пропускає й рахує", () => {
		const { clock, room, match } = setup();
		room.join({ id: "a", name: "A" });
		clock.advance(34);
		assert.equal(match.stats().ticks, 1);

		clock.jump(500); // процес завис
		clock.advance(540);
		const stats = match.stats();
		assert.equal(stats.ticks, 6);
		assert.ok(stats.skipped >= 9, `skipped = ${stats.skipped}`);
		assert.ok(stats.lateMs.max > 400);
		assert.equal(clock.pending, 1); // наступний тік уже в майбутньому
	});

	it("stats: розміри вимірів і форма", () => {
		const { clock, room, match } = setup();
		room.join({ id: "a", name: "A" });
		clock.advance(500);
		const s = match.stats();
		assert.equal(s.id, "r");
		assert.equal(s.tickRate, 30);
		assert.equal(s.tickMs.n, s.ticks);
		assert.equal(s.lateMs.n, s.ticks);
		assert.equal(s.intervalMs.n, s.ticks - 1);
	});
});

describe("Match: input і ack", () => {
	it("один input за тік по порядку, ack у знімку", () => {
		const { clock, room, snaps } = setup();
		room.join({ id: "a", name: "A" });
		input(room, "a", 1);
		input(room, "a", 2);
		input(room, "a", 3);
		clock.advance(140); // 4 тіки
		assert.deepEqual(
			snaps.map((s) => s.acks.get("a")),
			[1, 2, 3, 3],
		);
	});

	it("черга порожня: повторюється останній стан клавіш, ack стоїть", () => {
		const { clock, room, snaps } = setup();
		room.join({ id: "a", name: "A" });
		input(room, "a", 1);
		clock.advance(140);
		const [s1, , , s4] = snaps;
		assert.equal(s4.acks.get("a"), 1);
		assert.ok(shipOf(s4, "a").vx > shipOf(s1, "a").vx);
	});

	it("надлишок у черзі: старі відкидаються й вважаються підтвердженими", () => {
		const { clock, room, snaps } = setup();
		room.join({ id: "a", name: "A" });
		for (let seq = 1; seq <= 10; seq++) input(room, "a", seq);
		clock.advance(34);
		assert.equal(snaps[0].acks.get("a"), 7); // 1–6 відкинуто, 7 оброблено
		clock.advance(140);
		assert.equal(snaps.at(-1).acks.get("a"), 10);
	});

	it("дублікат або старий seq ігнорується", () => {
		const { clock, room, snaps } = setup();
		room.join({ id: "a", name: "A" });
		input(room, "a", 5);
		input(room, "a", 3);
		input(room, "a", 5);
		clock.advance(100);
		assert.deepEqual(
			snaps.map((s) => s.acks.get("a")),
			[5, 5, 5],
		);
	});

	it("input невідомого гравця ігнорується без помилки", () => {
		const { clock, room, snaps } = setup();
		room.join({ id: "a", name: "A" });
		input(room, "ghost", 1);
		clock.advance(40);
		assert.equal(snaps.length, 1);
		assert.equal(snaps[0].acks.has("ghost"), false);
	});

	it("гравці незалежні: кожен рухається своїм input", () => {
		const { clock, room, snaps } = setup();
		room.join({ id: "a", name: "A" });
		room.join({ id: "b", name: "B" });
		input(room, "a", 1, RIGHT);
		input(room, "b", 1, LEFT);
		clock.advance(40);
		assert.ok(shipOf(snaps[0], "a").vx > 0);
		assert.ok(shipOf(snaps[0], "b").vx < 0);
	});
});

describe("Match: знімок", () => {
	it("постріл потрапляє в events і bullets", () => {
		const { clock, room, snaps } = setup();
		room.join({ id: "a", name: "A" });
		input(room, "a", 1, { ...NONE, fire: true });
		clock.advance(40);
		const snap = snaps[0].snapshot;
		assert.equal(snap.bullets.length, 1);
		assert.ok(snap.events.some((e) => e.type === "fired" && e.player === "a"));
		assert.deepEqual(
			snaps[1].snapshot.events.filter((e) => e.type === "fired"),
			[],
		);
	});

	it("гравець вийшов: корабель і запис зникають", () => {
		const { clock, room, match, snaps } = setup();
		room.join({ id: "a", name: "A" });
		room.join({ id: "b", name: "B" });
		clock.advance(40);
		room.leave("b");
		clock.advance(80);
		const last = snaps.at(-1);
		assert.deepEqual(
			last.snapshot.ships.map((s) => s.player),
			["a"],
		);
		assert.equal(last.acks.has("b"), false);
		assert.equal(match.stats().players, 1);
	});

	it("збій у тіку зупиняє матч, а не процес", () => {
		const errors = [];
		const clock = fakeClock();
		const room = new Room({ id: "r", name: "R" });
		const match = new Match({
			room,
			log: { ...silentLogger, error: (...args) => errors.push(args) },
			now: clock.now,
			setTimer: clock.setTimer,
			clearTimer: clock.clearTimer,
			seed: () => 1,
		});
		room.on("snapshot", () => {
			throw new Error("boom");
		});
		room.join({ id: "a", name: "A" });
		clock.advance(40);
		assert.equal(errors.length, 1);
		assert.equal(match.running, false);
		assert.equal(clock.pending, 0);
	});
});
