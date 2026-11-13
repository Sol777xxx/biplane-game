import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createInterpolator, TICK_MS } from "../src/net/interpolator.js";
import { createSnapshotView } from "../src/net/snapshotView.js";

const LAT = 50;
const at = (tick) => tick * TICK_MS + LAT;
const near = (a, b, eps = 1e-6) =>
	assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

const row = (id, player, x) => ({
	id,
	player,
	x,
	y: 100,
	vx: 0,
	vy: 0,
	pitch: 0,
	facing: 1,
	cooldown: 0,
	shield: 0,
	rapid: 0,
	homing: 0,
	hp: 100,
});
const snap = (tick, xa, xb, extra = {}) => ({
	tick,
	ack: tick,
	players: [{ id: "a", score: 0 }],
	ships: [row(1, "a", xa), row(2, "b", xb)],
	obstacles: [],
	bullets: [],
	pickups: [],
	events: [],
	...extra,
});

function setup() {
	const interp = createInterpolator({ delay: 100 });
	const view = createSnapshotView({ you: () => "a", interp });
	for (const t of [10, 11, 12]) view.apply(snap(t, t * 10, t * 10), at(t));
	return { interp, view };
}

const ships = (view) =>
	new Map([...view.world.ofKind("biplane")].map((s) => [s.player, s]));

describe("snapshotView з інтерполяцією", () => {
	it("до update() сутностей немає, tick і ack одразу з останнього знімка", () => {
		const { view } = setup();
		assert.deepEqual([...view.world.ofKind("biplane")], []);
		assert.equal(view.tick, 12);
		assert.equal(view.ack, 12);
	});

	it("чужий корабель інтерполюється, свій береться з останнього знімка", () => {
		const { view } = setup();
		view.update(10.5 * TICK_MS + LAT + 100);
		const byPlayer = ships(view);
		near(byPlayer.get("b").pos.x, 105);
		assert.equal(byPlayer.get("b").mine, false);
		assert.equal(byPlayer.get("a").pos.x, 120);
		assert.equal(byPlayer.get("a").mine, true);
		assert.equal(view.me().ship.player, "a");
	});

	it("події чекають часу відтворення й видаються раз", () => {
		const interp = createInterpolator({ delay: 100 });
		const view = createSnapshotView({ you: () => "a", interp });
		const seen = [];
		view.bus.addEventListener("scored", (e) => seen.push(e.detail));
		const event = { type: "scored", player: "a", delta: 45, x: 1, y: 2 };
		view.apply(snap(10, 0, 0, { events: [event] }), at(10));
		view.apply(snap(11, 0, 0), at(11));
		view.apply(snap(12, 0, 0), at(12));

		view.update(10 * TICK_MS + LAT + 100 - 5); // ще рано
		assert.equal(seen.length, 0);
		view.update(10 * TICK_MS + LAT + 100 + 5);
		assert.equal(seen.length, 1);
		assert.equal(seen[0].delta, 45);
		view.update(10.5 * TICK_MS + LAT + 100);
		assert.equal(seen.length, 1);
	});

	it("reset очищає сутності й буфер", () => {
		const { view, interp } = setup();
		view.update(10.5 * TICK_MS + LAT + 100);
		view.reset();
		assert.deepEqual([...view.world.ofKind("biplane")], []);
		assert.equal(interp.stats().buffered, 0);
		view.update(1e6); // без знімка не падає
	});

	it("свій корабель, якого немає в знімку (загиблий), не малюється", () => {
		const { view } = setup();
		view.apply({ ...snap(13, 0, 130), ships: [row(2, "b", 130)] }, at(13));
		view.update(12.5 * TICK_MS + LAT + 100);
		assert.equal(view.me().ship, null);
		assert.equal(ships(view).has("b"), true);
	});

	it("без interp поведінка попередня: apply показує знімок одразу", () => {
		const view = createSnapshotView({ you: () => "a" });
		view.apply(snap(10, 100, 200));
		assert.equal(ships(view).get("b").pos.x, 200);
		view.update(0); // без interp нічого не робить
		assert.equal(ships(view).get("b").pos.x, 200);
	});
});
