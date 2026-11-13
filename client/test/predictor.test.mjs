import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Game } from "biplane-shared/sim/game.js";
import { takeSnapshot } from "biplane-shared/sim/snapshot.js";
import { TICK_DT } from "biplane-shared/sim/time.js";
import { createPredictor } from "../src/net/predictor.js";
import { createSnapshotView } from "../src/net/snapshotView.js";

const NONE = { up: false, down: false, left: false, right: false, fire: false };
const RIGHT = { ...NONE, right: true };

// Справжній Game як сервер: один input за тік, при порожній черзі повтор останніх клавіш.
// Мережа в обидва боки це delay тіків; lost(seq) губить input дорогою.
function simulate({ ticks, delay, keysAt, lost = () => false }) {
	const game = new Game({ obstacles: 0 }, { seed: 1 });
	game.addPlayer("a");
	const predictor = createPredictor();
	const toServer = [];
	const toClient = [];
	const queue = [];
	const corrections = [];
	let keys = NONE;
	let ack = 0;
	for (let k = 1; k <= ticks; k++) {
		const pressed = { ...NONE, ...keysAt(k) };
		predictor.step(k, pressed);
		if (!lost(k)) toServer.push({ at: k + delay, seq: k, keys: pressed });
		while (toServer.length && toServer[0].at <= k) queue.push(toServer.shift());
		const next = queue.shift();
		if (next) {
			keys = next.keys;
			ack = next.seq;
		}
		game.step(TICK_DT, new Map([["a", keys]]));
		toClient.push({ at: k + delay, snap: { ...takeSnapshot(game), ack } });
		while (toClient.length && toClient[0].at <= k) {
			const r = predictor.reconcile(toClient.shift().snap, "a");
			corrections.push(r.correction);
		}
	}
	return { game, predictor, corrections };
}

// рядок знімка для ручних випадків
const row = (id, x, extra = {}) => ({
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
	...extra,
});

describe("predictor: узгодження з сервером", () => {
	it("без втрат поправка лише похибка округлення знімка", () => {
		const { corrections } = simulate({
			ticks: 300,
			delay: 3,
			keysAt: (k) => ({
				right: k % 40 < 25,
				left: k % 40 >= 30,
				up: k % 70 < 20,
				down: k % 70 >= 50,
			}),
		});
		assert.ok(corrections.length > 250);
		assert.ok(
			Math.max(...corrections) < 0.1,
			`макс ${Math.max(...corrections)}`,
		);
	});

	it("втрачений input дає короткий сплеск поправок, далі знову ≈ 0", () => {
		const { corrections } = simulate({
			ticks: 200,
			delay: 3,
			keysAt: (k) => ({ right: true, up: k >= 50 && k < 80 }),
			lost: (k) => k === 50,
		});
		const big = corrections.filter((c) => c > 0.5);
		// сервер повторив клавіші (зайвий крок), потім наздогнав: пара поправок
		assert.ok(big.length >= 1 && big.length <= 3, `поправок ${big.length}`);
		assert.ok(Math.max(...big) < 30, `макс ${Math.max(...big)}`);
		assert.ok(Math.max(...corrections.slice(-50)) < 0.1);
	});

	it("нульова затримка: передбачення збігається зі станом сервера", () => {
		const { corrections } = simulate({
			ticks: 120,
			delay: 0,
			keysAt: (k) => ({ right: k % 30 < 20, up: k % 50 < 10 }),
		});
		assert.ok(Math.max(...corrections) < 0.1);
	});
});

describe("predictor: стан і буфер", () => {
	it("pending: підтверджені відкидаються, решта програється поверх стану сервера", () => {
		const p = createPredictor();
		for (const seq of [1, 2, 3]) p.step(seq, RIGHT);
		assert.equal(p.pending, 3);
		p.reconcile({ ack: 1, ships: [row(1, 100)] }, "a");
		assert.equal(p.pending, 2);
		assert.ok(p.ship.vel.x > 0);
		assert.ok(p.ship.pos.x > 100);
	});

	it("новий id корабля (відродження): скидання без поправки", () => {
		const p = createPredictor();
		assert.deepEqual(p.reconcile({ ack: 0, ships: [row(1, 100)] }, "a"), {
			reset: true,
			correction: 0,
		});
		assert.deepEqual(p.reconcile({ ack: 0, ships: [row(1, 100)] }, "a"), {
			reset: false,
			correction: 0,
		});
		assert.deepEqual(p.reconcile({ ack: 0, ships: [row(2, 900)] }, "a"), {
			reset: true,
			correction: 0,
		});
		assert.equal(p.ship.pos.x, 900);
	});

	it("корабля немає в знімку (загиблий): ship null, correction null", () => {
		const p = createPredictor();
		p.reconcile({ ack: 0, ships: [row(1, 100)] }, "a");
		assert.deepEqual(p.reconcile({ ack: 0, ships: [] }, "a"), {
			reset: false,
			correction: null,
		});
		assert.equal(p.ship, null);
		p.step(1, RIGHT); // без корабля input лише в буфері
		assert.equal(p.pending, 1);
	});

	it("поправка враховує загортання краю арени", () => {
		const p = createPredictor();
		p.reconcile({ ack: 0, ships: [row(1, 1599)] }, "a");
		const r = p.reconcile({ ack: 0, ships: [row(1, 1)] }, "a");
		assert.ok(Math.abs(r.correction - 2) < 1e-9, `поправка ${r.correction}`);
	});

	it("буфер обмежений 90 input", () => {
		const p = createPredictor();
		for (let seq = 1; seq <= 100; seq++) p.step(seq, NONE);
		assert.equal(p.pending, 90);
	});

	it("reset чистить буфер і корабель", () => {
		const p = createPredictor();
		p.reconcile({ ack: 0, ships: [row(1, 100)] }, "a");
		p.step(1, RIGHT);
		p.reset();
		assert.equal(p.ship, null);
		assert.equal(p.pending, 0);
	});

	it("вимкнений: нічого не робить, ship null; вмикання скидає стан", () => {
		const p = createPredictor();
		p.reconcile({ ack: 0, ships: [row(1, 100)] }, "a");
		p.enabled = false;
		assert.equal(p.ship, null);
		p.step(1, RIGHT);
		assert.equal(p.pending, 0);
		assert.deepEqual(p.reconcile({ ack: 0, ships: [row(1, 100)] }, "a"), {
			reset: false,
			correction: null,
		});
		p.enabled = true;
		assert.equal(p.ship, null);
		p.reconcile({ ack: 0, ships: [row(1, 100)] }, "a");
		assert.equal(p.ship.pos.x, 100);
	});
});

describe("snapshotView + predictor", () => {
	it("свій корабель рухається за передбаченням, чужий за знімком", () => {
		const p = createPredictor();
		p.reconcile({ ack: 0, ships: [row(1, 100)] }, "a");
		const view = createSnapshotView({ you: () => "a", local: () => p.ship });
		view.apply({
			tick: 1,
			ack: 0,
			ships: [row(1, 100), { ...row(2, 500), player: "b" }],
		});

		p.step(1, RIGHT);
		const ships = [...view.world.ofKind("biplane")];
		const mine = ships.find((s) => s.mine);
		const other = ships.find((s) => !s.mine);
		assert.equal(mine.pos.x, p.ship.pos.x);
		assert.ok(mine.pos.x > 100);
		assert.equal(mine.prevPos.x, 100); // позиція до останнього кроку для інтерполяції
		assert.equal(other.pos.x, 500);
		assert.equal(mine.hp, 100); // решта полів зі знімка
	});

	it("без передбачення свій корабель теж зі знімка", () => {
		const view = createSnapshotView({ you: () => "a", local: () => null });
		view.apply({ tick: 1, ack: 0, ships: [row(1, 100)] });
		const [mine] = view.world.ofKind("biplane");
		assert.equal(mine.pos.x, 100);
	});
});
