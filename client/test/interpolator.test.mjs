import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createInterpolator, TICK_MS } from "../src/net/interpolator.js";
import { formatNet } from "../src/netStats.js";

const LAT = 50; // постійна затримка пакета в тестах, мс
const near = (a, b, eps = 1e-6) =>
	assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

const ship = (id, x, extra = {}) => ({
	id,
	player: "b",
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
	...extra,
});
const snap = (tick, ships = [], extra = {}) => ({
	tick,
	ships,
	obstacles: [],
	bullets: [],
	pickups: [],
	events: [],
	...extra,
});
const at = (tick) => tick * TICK_MS + LAT; // коли знімок приходить

function filled(delay = 100, ticks = [10, 11, 12]) {
	const i = createInterpolator({ delay });
	for (const t of ticks) i.push(snap(t, [ship(1, t * 10)]), at(t));
	return i;
}

describe("interpolator: вибірка", () => {
	it("середина між двома знімками", () => {
		const i = filled();
		// t = now − 50 − 100 = ms(10) + інтервал/2
		const s = i.sample(10.5 * TICK_MS + LAT + 100);
		near(s.ships[0].x, 105);
		assert.equal(s.starved, false);
	});

	it("загортання краю: рух через межу, а не через усю арену", () => {
		const i = createInterpolator({ delay: 100 });
		i.push(snap(10, [ship(1, 1590)]), at(10));
		i.push(snap(11, [ship(1, 10)]), at(11));
		i.push(snap(12, [ship(1, 30)]), at(12));
		const s = i.sample(10.25 * TICK_MS + LAT + 100);
		near(s.ships[0].x, 1595);
	});

	it("поява й зникнення: нова не показується, зникла стоїть на місці", () => {
		const i = createInterpolator({ delay: 100 });
		i.push(snap(10, [ship(1, 100), ship(2, 500)]), at(10));
		i.push(snap(11, [ship(1, 200), ship(3, 900)]), at(11));
		i.push(snap(12, [ship(1, 300), ship(3, 900)]), at(12));
		const s = i.sample(10.5 * TICK_MS + LAT + 100);
		const byId = new Map(s.ships.map((r) => [r.id, r]));
		near(byId.get(1).x, 150);
		assert.equal(byId.get(2).x, 500);
		assert.equal(byId.has(3), false);
	});

	it("дискретні поля беруться з ближчого знімка", () => {
		const i = createInterpolator({ delay: 100 });
		i.push(snap(10, [ship(1, 0, { facing: 1, hp: 100 })]), at(10));
		i.push(snap(11, [ship(1, 0, { facing: -1, hp: 66 })]), at(11));
		i.push(snap(12, [ship(1, 0, { facing: -1, hp: 66 })]), at(12));
		assert.equal(i.sample(10.25 * TICK_MS + LAT + 100).ships[0].facing, 1);
		assert.equal(i.sample(10.75 * TICK_MS + LAT + 100).ships[0].facing, -1);
	});

	it("немає новішого знімка: стоїть на останньому, голод рахується", () => {
		const i = filled();
		const s = i.sample(12 * TICK_MS + LAT + 1000);
		assert.equal(s.starved, true);
		assert.equal(s.ships[0].x, 120);
		assert.ok(i.stats().starvedPct > 0);
	});

	it("раніше за перший знімок: показується перший", () => {
		const i = filled();
		const s = i.sample(0);
		assert.equal(s.starved, false);
		assert.equal(s.ships[0].x, 100);
	});

	it("порожній буфер: t null", () => {
		const s = createInterpolator().sample(1000);
		assert.equal(s.t, null);
		assert.deepEqual(s.ships, []);
	});

	it("затримка змінюється наживо й обмежується 0–500", () => {
		const now = at(13);
		const sampleWith = (delay) => {
			const i = filled(delay, [10, 11, 12, 13]);
			return i.sample(now).ships[0].x;
		};
		assert.equal(sampleWith(0), 130); // найновіший
		near(sampleWith(100), 100, 0.01); // на 3 тіки раніше

		const i = createInterpolator();
		i.delay = 9999;
		assert.equal(i.delay, 500);
		i.delay = -5;
		assert.equal(i.delay, 0);
	});

	it("буфер обрізається за вибіркою й обмежений 64", () => {
		const i = createInterpolator({ delay: 100 });
		for (let t = 1; t <= 200; t++) i.push(snap(t, [ship(1, t)]), at(t));
		assert.equal(i.stats().buffered, 64);
		i.sample(at(150) + 100);
		assert.ok(i.stats().buffered < 64);
		assert.ok(i.stats().buffered <= 64 - 10);
	});
});

describe("interpolator: годинник", () => {
	it("зсув: мінімум за вікно, рух не швидше slew мс на знімок", () => {
		const i = createInterpolator({ slew: 1 });
		i.push(snap(1), 1 * TICK_MS + 80); // перший пакет повільний
		near(i.stats().offset, 80);
		for (let t = 2; t <= 11; t++) i.push(snap(t), t * TICK_MS + 50);
		near(i.stats().offset, 70); // 10 знімків: 10 мс вниз
		for (let t = 12; t <= 40; t++) i.push(snap(t), t * TICK_MS + 50);
		near(i.stats().offset, 50);
	});

	it("тік назад це новий матч: буфер і зсув скидаються", () => {
		const i = filled();
		i.push(snap(3, [ship(1, 0)]), 5000);
		assert.equal(i.stats().buffered, 1);
		near(i.stats().offset, 5000 - 3 * TICK_MS);
	});

	it("той самий тік двічі й знімок без tick ігноруються", () => {
		const i = createInterpolator();
		i.push(snap(5), at(5));
		i.push(snap(5), at(5) + 10);
		i.push({ ships: [] }, at(6));
		i.push(null, at(6));
		assert.equal(i.stats().buffered, 1);
	});

	it("розкид пакетів 0–30 мс: при delay 100 голоду немає, при 10 є", () => {
		function run(delay) {
			const i = createInterpolator({ delay });
			const arrivals = [];
			let prev = 0;
			for (let t = 1; t <= 150; t++) {
				const when = Math.max(prev, t * TICK_MS + LAT + ((t * 7) % 31));
				arrivals.push({ t, when });
				prev = when;
			}
			let idx = 0;
			let starved = 0;
			for (let now = 0; now < 150 * TICK_MS + LAT; now += 1000 / 60) {
				while (idx < arrivals.length && arrivals[idx].when <= now) {
					i.push(
						snap(arrivals[idx].t, [ship(1, arrivals[idx].t)]),
						arrivals[idx].when,
					);
					idx++;
				}
				if (now > 2000 && i.sample(now).starved) starved++;
			}
			return starved;
		}
		assert.equal(run(100), 0);
		assert.ok(run(10) > 20);
	});
});

describe("interpolator: події", () => {
	it("видаються, коли час відтворення дійшов до знімка, і лише раз", () => {
		const i = createInterpolator();
		i.push(
			snap(10, [], { events: [{ type: "hit" }, { type: "fired" }] }),
			at(10),
		);
		i.push(snap(11, [], { events: [{ type: "scored" }] }), at(11));
		const ms10 = 10 * TICK_MS;
		assert.deepEqual(i.drain(ms10 - 1), []);
		assert.deepEqual(
			i.drain(ms10).map((e) => e.type),
			["hit", "fired"],
		);
		assert.deepEqual(i.drain(ms10), []);
		assert.deepEqual(
			i.drain(11 * TICK_MS).map((e) => e.type),
			["scored"],
		);
	});

	it("drain(null) і reset не падають і нічого не видають", () => {
		const i = createInterpolator();
		i.push(snap(10, [], { events: [{ type: "hit" }] }), at(10));
		assert.deepEqual(i.drain(null), []);
		i.reset();
		assert.deepEqual(i.drain(1e9), []);
		assert.equal(i.stats().buffered, 0);
	});
});

describe("formatNet: інтерполяція", () => {
	const r = {
		rtt: null,
		rttAvg: 0,
		rttMax: 0,
		age: null,
		ageMax: 0,
		snapsPerSec: 30,
		bytesInPerSec: 0,
		bytesOutPerSec: 0,
		intervals: [],
	};

	it("рядок із затримкою, буфером і голодом", () => {
		const text = formatNet(r, {
			interp: { delay: 100, buffered: 4, starvedPct: 1.6 },
		});
		assert.match(text, /інтерполяція: 100 мс · буфер 4 · голод 2%/);
	});

	it("без інтерполяції рядка немає", () => {
		assert.doesNotMatch(formatNet(r), /інтерполяція/);
	});
});
