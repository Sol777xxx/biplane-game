import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createNetStats, formatNet } from "../src/netStats.js";

const base = {
	rtt: 80,
	rttAvg: 80,
	rttMax: 80,
	age: 10,
	ageMax: 40,
	snapsPerSec: 30,
	bytesInPerSec: 0,
	bytesOutPerSec: 0,
	intervals: [],
};

describe("netStats: поправка", () => {
	it("остання й максимум за вікно 30", () => {
		const s = createNetStats({ now: () => 0 });
		assert.equal(s.read(0).correction, null);
		s.correction(0.02);
		s.correction(4.5);
		s.correction(0.1);
		const r = s.read(0);
		assert.equal(r.correction, 0.1);
		assert.equal(r.correctionMax, 4.5);
		for (let i = 0; i < 30; i++) s.correction(0.01);
		assert.equal(s.read(0).correctionMax, 0.01); // великі витіснились
	});

	it("clearCorrection повертає null", () => {
		const s = createNetStats({ now: () => 0 });
		s.correction(3);
		s.clearCorrection();
		const r = s.read(0);
		assert.equal(r.correction, null);
		assert.equal(r.correctionMax, 0);
	});

	it("formatNet показує поправку з максимумом або тире", () => {
		assert.match(
			formatNet({ ...base, correction: 0.04, correctionMax: 3.26 }),
			/поправка:\s+0\.0 px \(макс 3\.3\)/,
		);
		assert.match(formatNet({ ...base, correction: null }), /поправка:\s+—/);
		assert.match(formatNet(base), /поправка:\s+—/);
	});
});
