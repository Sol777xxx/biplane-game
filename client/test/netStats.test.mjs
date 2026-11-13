import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createNetStats, formatNet } from "../src/netStats.js";

describe("createNetStats", () => {
	it("проміжки між знімками й вік знімка", () => {
		const s = createNetStats({ now: () => 0 });
		assert.equal(s.read(0).age, null);
		s.snapshot(0);
		s.snapshot(33);
		s.snapshot(66);
		s.snapshot(166);
		const r = s.read(200);
		assert.deepEqual(r.intervals, [33, 33, 100]);
		assert.equal(r.age, 34);
		assert.equal(r.ageMax, 100);
		assert.equal(s.read(400).ageMax, 234); // поточне очікування теж у максимумі
	});

	it("перший знімок проміжку не дає", () => {
		const s = createNetStats({ now: () => 0 });
		s.snapshot(10);
		assert.deepEqual(s.read(10).intervals, []);
		assert.equal(s.read(10).age, 0);
	});

	it("кільце проміжків обмежене 120", () => {
		const s = createNetStats({ now: () => 0 });
		for (let i = 0; i < 300; i++) s.snapshot(i * 33);
		assert.equal(s.read(300 * 33).intervals.length, 120);
	});

	it("RTT: останній, середнє, мін, макс; вікно 10", () => {
		const s = createNetStats({ now: () => 0 });
		assert.equal(s.read(0).rtt, null);
		for (const v of [100, 120, 80]) s.pong(v);
		const r = s.read(0);
		assert.equal(r.rtt, 80);
		assert.equal(r.rttAvg, 100);
		assert.equal(r.rttMin, 80);
		assert.equal(r.rttMax, 120);
		for (let i = 0; i < 20; i++) s.pong(50);
		assert.equal(s.read(0).rttMax, 50);
	});

	it("швидкості оновлюються раз на секунду", () => {
		const s = createNetStats({ now: () => 0 });
		s.sample({ bytesIn: 0, bytesOut: 0 }, 0);
		for (let i = 0; i < 30; i++) s.snapshot(i * 33);
		s.sample({ bytesIn: 61_440, bytesOut: 2048 }, 500); // ще не секунда
		assert.equal(s.read(500).bytesInPerSec, 0);

		s.sample({ bytesIn: 61_440, bytesOut: 2048 }, 1000);
		let r = s.read(1000);
		assert.equal(r.snapsPerSec, 30);
		assert.equal(r.bytesInPerSec, 61_440);
		assert.equal(r.bytesOutPerSec, 2048);

		// наступне вікно: тиша
		s.sample({ bytesIn: 61_440, bytesOut: 2048 }, 2000);
		r = s.read(2000);
		assert.equal(r.snapsPerSec, 0);
		assert.equal(r.bytesInPerSec, 0);
	});
});

describe("formatNet", () => {
	const base = {
		rtt: 80,
		rttAvg: 100.4,
		rttMax: 120,
		age: 21.2,
		ageMax: 148.7,
		snapsPerSec: 29.84,
		bytesInPerSec: 61_440,
		bytesOutPerSec: 2048,
		intervals: [],
	};

	it("усі рядки з числами", () => {
		const text = formatNet(base, { unacked: 3, tick: 1234 });
		assert.match(text, /RTT:\s+80 мс \(сер\. 100, макс 120\)/);
		assert.match(text, /вік знімка:\s+21 мс \(макс 149\)/);
		assert.match(text, /знімків\/с:\s+29\.8\s+tick 1234/);
		assert.match(text, /↓ 60\.0 КБ\/с\s+↑ 2\.0 КБ\/с/);
		assert.match(text, /input без ack: 3/);
		assert.match(text, /поправка:\s+—/);
		assert.doesNotMatch(text, /мережа:/);
	});

	it("порожні виміри це тире", () => {
		const text = formatNet({ ...base, rtt: null, age: null });
		assert.match(text, /RTT:\s+—/);
		assert.match(text, /вік знімка:\s+—/);
	});

	it("поправка й штучна мережа з'являються, коли відомі", () => {
		const text = formatNet(base, {
			correction: 2.46,
			netsim: { enabled: true, lag: 100, jitter: 30, loss: 2 },
		});
		assert.match(text, /поправка:\s+2\.5 px/);
		assert.match(text, /мережа:\s+100 ± 30 мс, втрати 2%/);
		const off = formatNet(base, {
			netsim: { enabled: false, lag: 0, jitter: 0, loss: 0 },
		});
		assert.doesNotMatch(off, /мережа:/);
	});
});
