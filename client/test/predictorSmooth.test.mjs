import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPredictor } from "../src/net/predictor.js";
import { createSnapshotView } from "../src/net/snapshotView.js";

const row = (id, x) => ({
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

const near = (a, b, eps = 1e-6) =>
	assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

// передбачений корабель стояв у x=100, сервер виправляє його на 110: поправка 10 px
function corrected(options) {
	const p = createPredictor(options);
	p.reconcile({ ack: 0, ships: [row(1, 100)] }, "a");
	const r = p.reconcile({ ack: 0, ships: [row(1, 110)] }, "a");
	return { p, r };
}

describe("predictor: згладжування", () => {
	it("після звірки корабель на екрані лишається там, де був", () => {
		const { p, r } = corrected();
		assert.equal(r.correction, 10); // netgraph бачить сиру поправку
		assert.equal(p.ship.pos.x, 110); // сирий корабель уже в стані сервера
		near(p.pose.pos.x, 100); // видима позиція не стрибнула
	});

	it("зсув згасає: ~95% за 100 мс, монотонно", () => {
		const { p } = corrected();
		p.tick(0.1);
		near(p.pose.pos.x, 110 - 10 * Math.exp(-3), 1e-9);

		const q = corrected().p;
		const xs = [];
		for (let i = 0; i < 12; i++) {
			q.tick(1 / 30);
			xs.push(q.pose.pos.x);
		}
		for (let i = 1; i < xs.length; i++) assert.ok(xs[i] >= xs[i - 1]);
		assert.equal(xs.at(-1), 110); // дрібний залишок обнулюється
	});

	it("нова поправка додається до поточного зсуву без стрибка", () => {
		const { p } = corrected();
		p.tick(0.05);
		const shown = p.pose.pos.x;
		const r = p.reconcile({ ack: 0, ships: [row(1, 114)] }, "a");
		near(r.correction, 4);
		near(p.pose.pos.x, shown, 1e-9);
	});

	it("prevPos несе попередній зсув (для інтерполяції кадрів)", () => {
		const { p } = corrected();
		const gap = () => ({
			pos: p.pose.pos.x - p.ship.pos.x,
			prev: p.pose.prevPos.x - p.ship.prevPos.x,
		});
		near(gap().pos, -10);
		near(gap().prev, -10); // одразу після звірки без розриву
		p.tick(0.05);
		near(gap().pos, -10 * Math.exp(-1.5), 1e-9);
		near(gap().prev, -10);
	});

	it("відродження (новий id) скидає зсув", () => {
		const { p } = corrected();
		p.reconcile({ ack: 0, ships: [row(2, 900)] }, "a");
		assert.equal(p.pose.pos.x, 900);
		p.tick(0.05);
		assert.equal(p.pose.pos.x, 900);
	});

	it("загибель скидає зсув і прибирає pose", () => {
		const { p } = corrected();
		p.reconcile({ ack: 0, ships: [] }, "a");
		assert.equal(p.pose, null);
		p.reconcile({ ack: 0, ships: [row(1, 300)] }, "a");
		assert.equal(p.pose.pos.x, 300);
	});

	it("smooth 0: видима позиція дорівнює сирій, поправка та сама", () => {
		const { p, r } = corrected({ smooth: 0 });
		assert.equal(r.correction, 10);
		assert.equal(p.pose.pos.x, 110);
		p.tick(0.05);
		assert.equal(p.pose.pos.x, 110);
	});

	it("вимкнене передбачення: pose null", () => {
		const { p } = corrected();
		p.enabled = false;
		assert.equal(p.pose, null);
	});
});

describe("snapshotView бере pose", () => {
	it("свій корабель малюється зі зсувом, решта полів зі знімка", () => {
		const { p } = corrected();
		const view = createSnapshotView({ you: () => "a", local: () => p.pose });
		view.apply({ tick: 1, ack: 0, ships: [row(1, 110)] });
		const [mine] = view.world.ofKind("biplane");
		near(mine.pos.x, 100);
		near(mine.prevPos.x, 100);
		assert.equal(mine.hp, 100);
	});
});
