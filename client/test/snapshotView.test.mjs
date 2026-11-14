import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Biplane } from "biplane-shared/sim/biplane.js";
import { Game } from "biplane-shared/sim/game.js";
import { Bullet, Pickup } from "biplane-shared/sim/objects.js";
import { eventToWire, takeSnapshot } from "biplane-shared/sim/snapshot.js";
import { TICK_DT } from "biplane-shared/sim/time.ts";
import { createFx } from "../src/fx.js";
import { createHud } from "../src/hud.js";
import { eventFromWire } from "../src/net/events.js";
import {
	BULLET_RADIUS,
	createSnapshotView,
	PICKUP_RADIUS,
	SHIP_RADIUS,
} from "../src/net/snapshotView.js";

// справжній знімок справжньої гри: два гравці, дві хмарки, куля, бонус
function fixture() {
	const game = new Game({ obstacles: 2 }, { seed: 1 });
	const a = game.addPlayer("a");
	game.addPlayer("b");
	a.plane.cooldown = 0;
	a.plane.fire();
	game.world.spawn(new Pickup({ x: 300, y: 300, type: "rapid" }));
	game.step(TICK_DT);
	const snap = takeSnapshot(game);
	snap.events = [];
	snap.ack = 0;
	return snap;
}

const record = (bus, types) => {
	const seen = [];
	for (const type of types) {
		bus.addEventListener(type, (e) => seen.push({ type, detail: e.detail }));
	}
	return seen;
};

describe("snapshotView", () => {
	it("сутності за видами, свій корабель позначений", () => {
		const view = createSnapshotView({ you: () => "a" });
		view.apply(fixture());
		const ships = [...view.world.ofKind("biplane")];
		assert.equal(ships.length, 2);
		assert.equal(ships.filter((s) => s.mine).length, 1);
		assert.equal(ships.find((s) => s.mine).player, "a");
		assert.equal([...view.world.ofKind("obstacle")].length, 2);
		assert.equal([...view.world.ofKind("bullet")].length, 1);
		assert.equal([...view.world.ofKind("pickup")].length, 1);
		assert.deepEqual([...view.world.ofKind("particle")], []);
	});

	it("сутності мають поля, які читає renderer", () => {
		const view = createSnapshotView({ you: () => "a" });
		view.apply(fixture());
		for (const kind of ["biplane", "obstacle", "bullet", "pickup"]) {
			for (const e of view.world.ofKind(kind)) {
				assert.ok(Number.isFinite(e.pos.x) && Number.isFinite(e.pos.y), kind);
				assert.equal(e.prevPos.x, e.pos.x, kind);
				assert.notEqual(e.prevPos, e.pos, kind);
				assert.ok(e.radius > 0, kind);
			}
		}
		const [plane] = view.world.ofKind("biplane");
		assert.equal(plane.prevPitch, plane.pitch);
		assert.ok(plane.effects.shield > 0);
		const [b] = view.world.ofKind("bullet");
		assert.equal(typeof b.vel.x, "number");
		assert.equal(typeof b.ttl, "number");
	});

	it("радіуси збігаються з shared/sim", () => {
		assert.equal(SHIP_RADIUS, new Biplane().radius);
		assert.equal(
			PICKUP_RADIUS,
			new Pickup({ x: 0, y: 0, type: "shield" }).radius,
		);
		assert.equal(
			BULLET_RADIUS,
			new Bullet({ owner: null, x: 0, y: 0, vx: 0, vy: 0 }).radius,
		);
	});

	it("me(): свій корабель і лічильники; чужий id або порожньо дає null", () => {
		const view = createSnapshotView({ you: () => "a" });
		assert.deepEqual(view.me(), { ship: null, player: null });
		view.apply(fixture());
		const { ship, player } = view.me();
		assert.equal(ship.player, "a");
		assert.equal(player.id, "a");

		const nobody = createSnapshotView({ you: () => "zzz" });
		nobody.apply(fixture());
		assert.deepEqual(nobody.me(), { ship: null, player: null });
	});

	it("новий знімок замінює попередній", () => {
		const view = createSnapshotView({ you: () => "a" });
		view.apply(fixture());
		view.apply({ ...fixture(), ships: [], bullets: [], tick: 99, ack: 7 });
		assert.equal([...view.world.ofKind("biplane")].length, 0);
		assert.equal([...view.world.ofKind("bullet")].length, 0);
		assert.equal(view.tick, 99);
		assert.equal(view.ack, 7);
	});

	it("події знімка йдуть на шину у формі підписників, невідомі відкидаються", () => {
		const view = createSnapshotView({ you: () => "a" });
		const seen = record(view.bus, ["scored", "hit", "respawned", "dance"]);
		const snap = fixture();
		snap.events = [
			eventToWire("scored", {
				player: "a",
				delta: 45,
				at: { x: 100.4, y: 200.6 },
			}),
			eventToWire("hit", { target: { kind: "obstacle" }, at: { x: 1, y: 2 } }),
			{ type: "dance" },
			eventToWire("respawned", { player: "a", at: { x: 5, y: 6 } }),
		];
		view.apply(snap);
		assert.deepEqual(
			seen.map((s) => s.type),
			["scored", "hit", "respawned"],
		);
		assert.deepEqual(seen[0].detail, {
			player: "a",
			delta: 45,
			at: { x: 100, y: 201 },
		});
		assert.equal(seen[1].detail.target.kind, "obstacle");
	});

	it("події доходять до fx і hud, як і з локальної гри", () => {
		const view = createSnapshotView({ you: () => "a" });
		const fx = createFx(view.bus);
		const hud = createHud(view.bus);
		const snap = fixture();
		snap.events = [
			eventToWire("exploded", {
				kind: "obstacle",
				pos: { x: 10, y: 20 },
				size: 45,
				color: "storm",
				count: 26,
			}),
			eventToWire("scored", { player: "a", delta: 45, at: { x: 10, y: 20 } }),
		];
		view.apply(snap);
		assert.equal(fx.world.count("explosion"), 1);
		assert.equal(fx.world.count("particle"), 26);
		assert.equal(hud.count, 1);
		fx.dispose();
		hud.dispose();
	});
});

describe("eventFromWire", () => {
	it("зламані й невідомі події дають null", () => {
		for (const w of [
			null,
			5,
			"x",
			{},
			{ type: "toString" },
			{ type: "dance" },
			{ type: "hit", kind: "obstacle" }, // немає координат
			{ type: "hit", x: 1, y: 2 }, // немає kind
			{ type: "scored", x: 1, y: 2 }, // немає delta
			{ type: "scored", x: Number.NaN, y: 2, delta: 5 },
			{ type: "exploded", x: 1, y: 2, kind: "obstacle" },
			{ type: "pickup" },
		]) {
			assert.equal(eventFromWire(w), null, JSON.stringify(w));
		}
	});

	it("кількість частинок обмежена", () => {
		const ev = eventFromWire({
			type: "exploded",
			kind: "obstacle",
			x: 1,
			y: 2,
			size: 45,
			color: "storm",
			count: 1e9,
		});
		assert.equal(ev.detail.count, 80);
		const view = createSnapshotView();
		const fx = createFx(view.bus);
		view.apply({
			tick: 1,
			events: [
				{
					type: "exploded",
					kind: "obstacle",
					x: 1,
					y: 2,
					size: 45,
					color: "storm",
					count: 1e9,
				},
			],
		});
		assert.equal(fx.world.count("particle"), 80);
		fx.dispose();
	});

	it("кожна подія, яку шле сервер, розпізнається", () => {
		const at = { x: 10.4, y: 20.6 };
		const samples = [
			["fired", { by: { playerId: "a" }, at }],
			["hit", { target: { kind: "biplane" }, at }],
			[
				"exploded",
				{ kind: "biplane", pos: at, size: 46, color: "pink", count: 50 },
			],
			["scored", { player: "a", delta: 70, at }],
			["pickup", { type: "shield", player: "a" }],
			["crash", { player: "a", at }],
			["respawned", { player: "a", at }],
		];
		for (const [type, detail] of samples) {
			const ev = eventFromWire(eventToWire(type, detail));
			assert.equal(ev?.type, type, type);
		}
	});
});
