import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Game } from "biplane-shared/sim/game.js";
import { takeSnapshot } from "biplane-shared/sim/snapshot.js";
import { TICK_DT } from "biplane-shared/sim/time.js";
import { createInterpolator, TICK_MS } from "../src/net/interpolator.js";
import { createPredictor } from "../src/net/predictor.js";
import { createSnapshotView } from "../src/net/snapshotView.js";

const NONE = { up: false, down: false, left: false, right: false, fire: false };
const FIRE = { ...NONE, fire: true };
const near = (a, b, eps = 1e-6) =>
	assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

const ship = (id, x) => ({
	id,
	player: "a",
	x,
	y: 200,
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
// куля сервера: стартова позиція муздра (196, 200), швидкість 720 px/с
const bullet = (id, seq, x, extra = {}) => ({
	id,
	owner: "a",
	seq,
	x,
	y: 200,
	vx: 720,
	vy: 0,
	ttl: 1.6,
	...extra,
});

function setup() {
	const fires = [];
	const p = createPredictor({ onFire: (at) => fires.push(at) });
	p.reconcile({ ack: 0, ships: [ship(1, 100)], bullets: [] }, "a");
	return { p, fires };
}

describe("predictor: свої кулі", () => {
	it("постріл: куля й подія одразу, перезарядка не дає другої", () => {
		const { p, fires } = setup();
		p.step(1, FIRE);
		assert.deepEqual(fires, [{ x: 196, y: 200 }]);
		assert.equal(p.shots.length, 1);
		p.step(2, FIRE);
		assert.equal(fires.length, 1);
		assert.equal(p.shots.length, 1);
		near(p.shots[0].pos.x, 220); // перший крок руху після появи
	});

	it("куля живе ttl і зникає", () => {
		const { p } = setup();
		p.step(1, FIRE);
		for (let k = 2; k <= 50; k++) p.step(k, NONE);
		assert.equal(p.shots.length, 0);
	});

	it("усиновлення: стан сервера плюс кроки, на які клієнт попереду", () => {
		const { p } = setup();
		p.step(1, FIRE);
		p.step(2, NONE);
		// сервер обробив seq 1 (ack 1): куля на старті; попереду ще один input (seq 2)
		p.reconcile(
			{ ack: 1, ships: [ship(1, 100)], bullets: [bullet(50, 1, 196)] },
			"a",
		);
		assert.equal(p.shots.length, 1);
		near(p.shots[0].pos.x, 220);
		near(p.shots[0].ttl, 1.6 - TICK_DT, 1e-9);

		// наступний знімок: куля пішла далі, усиновлена за id
		p.reconcile(
			{ ack: 2, ships: [ship(1, 100)], bullets: [bullet(50, 1, 220)] },
			"a",
		);
		assert.equal(p.shots.length, 1);
		near(p.shots[0].pos.x, 220);
	});

	it("усиновлена куля зникає, коли сервер її більше не надсилає", () => {
		const { p } = setup();
		p.step(1, FIRE);
		p.reconcile(
			{ ack: 1, ships: [ship(1, 100)], bullets: [bullet(50, 1, 196)] },
			"a",
		);
		assert.equal(p.shots.length, 1);
		p.reconcile({ ack: 2, ships: [ship(1, 100)], bullets: [] }, "a"); // влучила
		assert.equal(p.shots.length, 0);
	});

	it("без пари: зникає при ack ≥ seq, лишається при ack < seq", () => {
		const a = setup();
		a.p.step(1, FIRE);
		a.p.reconcile({ ack: 0, ships: [ship(1, 100)], bullets: [] }, "a");
		assert.equal(a.p.shots.length, 1);
		a.p.reconcile({ ack: 1, ships: [ship(1, 100)], bullets: [] }, "a");
		assert.equal(a.p.shots.length, 0);
	});

	it("своя куля сервера без локальної пари усиновлюється, чужа ні", () => {
		const { p } = setup();
		p.reconcile(
			{
				ack: 0,
				ships: [ship(1, 100)],
				bullets: [bullet(9, 0, 500), bullet(10, 0, 600, { owner: "b" })],
			},
			"a",
		);
		assert.equal(p.shots.length, 1);
		near(p.shots[0].pos.x, 500);
		p.reconcile({ ack: 0, ships: [ship(1, 100)], bullets: [] }, "a");
		assert.equal(p.shots.length, 0);
	});

	it("повтор input при звірці не дублює кулі й не кличе onFire", () => {
		const { p, fires } = setup();
		p.step(1, FIRE);
		p.step(2, NONE);
		p.reconcile({ ack: 0, ships: [ship(1, 100)], bullets: [] }, "a");
		assert.equal(p.shots.length, 1);
		assert.equal(fires.length, 1);
	});

	it("вимкнене: кулі немає, вмикання й reset очищають", () => {
		const { p } = setup();
		p.step(1, FIRE);
		p.enabled = false;
		assert.deepEqual(p.shots, []);
		p.enabled = true;
		assert.deepEqual(p.shots, []);
		p.reconcile({ ack: 0, ships: [ship(1, 100)], bullets: [] }, "a");
		p.step(1, FIRE);
		p.reset();
		assert.deepEqual(p.shots, []);
	});
});

// сервер і клієнт в одному потоці; мережа це затримка в тіках в обидва боки
function simulate({ ticks, delay, fireUntil, check }) {
	const game = new Game({ obstacles: 0 }, { seed: 3 });
	game.addPlayer("a");
	const p = createPredictor({ smooth: 0 });
	const toServer = [];
	const toClient = [];
	const queue = [];
	const counts = [];
	let keys = NONE;
	let ack = 0;
	for (let k = 1; k <= ticks; k++) {
		const pressed = k >= 5 && k <= fireUntil ? FIRE : NONE;
		p.step(k, pressed);
		toServer.push({ at: k + delay, seq: k, keys: pressed });
		while (toServer.length && toServer[0].at <= k) queue.push(toServer.shift());
		const next = queue.shift();
		if (next) {
			keys = next.keys;
			ack = next.seq;
		}
		game.step(
			TICK_DT,
			new Map([["a", next ? { ...next.keys, seq: next.seq } : keys]]),
		);
		toClient.push({ at: k + delay, snap: { ...takeSnapshot(game), ack } });
		while (toClient.length && toClient[0].at <= k) {
			p.reconcile(toClient.shift().snap, "a");
		}
		counts.push(p.shots.length);
		check?.(k, p, game);
	}
	return { p, game, counts };
}

const serverBullets = (game) =>
	[...game.world.ofKind("bullet")].filter((b) => b.alive);
const byX = (a, b) => a.pos.x - b.pos.x;

describe("predictor: кулі проти справжнього сервера", () => {
	it("нульова затримка: кулі клієнта збігаються з кулями сервера щотіку", () => {
		let compared = 0;
		simulate({
			ticks: 90,
			delay: 0,
			fireUntil: 60,
			check(k, p, game) {
				if (k < 6) return;
				const mine = [...p.shots].sort(byX);
				const server = serverBullets(game).sort(byX);
				assert.equal(mine.length, server.length, `тік ${k}`);
				mine.forEach((m, i) => {
					near(m.pos.x, server[i].pos.x, 0.02);
					near(m.pos.y, server[i].pos.y, 0.02);
				});
				compared += mine.length;
			},
		});
		assert.ok(compared > 20, `порівняно ${compared}`);
	});

	it("затримка 3 тіки: дублів немає, наприкінці куль не лишається", () => {
		const { p, game, counts } = simulate({
			ticks: 140,
			delay: 3,
			fireUntil: 60,
		});
		assert.ok(Math.max(...counts) > 0);
		assert.ok(Math.max(...counts) <= 7, `макс ${Math.max(...counts)}`);
		assert.equal(p.shots.length, 0);
		assert.equal(serverBullets(game).length, 0);
	});
});

describe("snapshotView: свої кулі", () => {
	const fake = {
		id: 0,
		kind: "bullet",
		pos: { x: 5, y: 5 },
		prevPos: { x: 5, y: 5 },
		vel: { x: 0, y: 0 },
		ttl: 1,
		radius: 8,
	};
	const msg = {
		tick: 1,
		ack: 0,
		ships: [],
		bullets: [bullet(1, 1, 100), bullet(2, 0, 300, { owner: "b" })],
		events: [
			{ type: "fired", player: "a", x: 1, y: 2 },
			{ type: "fired", player: "b", x: 3, y: 4 },
		],
	};
	const record = (view) => {
		const seen = [];
		view.bus.addEventListener("fired", (e) => seen.push(e.detail.by.playerId));
		return seen;
	};

	it("з shots: свої кулі зі знімка прибираються, передбачені додаються, свій fired глушиться", () => {
		const view = createSnapshotView({ you: () => "a", shots: () => [fake] });
		const seen = record(view);
		view.apply(msg);
		const bullets = [...view.world.ofKind("bullet")];
		assert.deepEqual(
			bullets.map((b) => b.id),
			[2, 0],
		);
		assert.deepEqual(seen, ["b"]);
	});

	it("shots повертає null (передбачення вимкнене): усе зі знімка", () => {
		const view = createSnapshotView({ you: () => "a", shots: () => null });
		const seen = record(view);
		view.apply(msg);
		assert.deepEqual(
			[...view.world.ofKind("bullet")].map((b) => b.id),
			[1, 2],
		);
		assert.deepEqual(seen, ["a", "b"]);
	});

	it("без shots поведінка попередня", () => {
		const view = createSnapshotView({ you: () => "a" });
		view.apply(msg);
		assert.equal([...view.world.ofKind("bullet")].length, 2);
	});

	it("з інтерполяцією ті самі правила", () => {
		const interp = createInterpolator({ delay: 100 });
		const view = createSnapshotView({
			you: () => "a",
			interp,
			shots: () => [fake],
		});
		for (const t of [10, 11, 12]) {
			view.apply({ ...msg, tick: t, events: [] }, t * TICK_MS + 50);
		}
		view.update(10.5 * TICK_MS + 50 + 100);
		assert.deepEqual(
			[...view.world.ofKind("bullet")].map((b) => b.id),
			[2, 0],
		);
	});
});
