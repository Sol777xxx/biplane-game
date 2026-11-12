import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CLOSE, validate } from "../src/protocol.js";

const INPUT = {
	v: 1,
	type: "input",
	seq: 7,
	up: false,
	down: false,
	left: false,
	right: true,
	fire: true,
};

describe("validate", () => {
	it("правильний join, ім'я обрізається", () => {
		const r = validate({ v: 1, type: "join", room: "calm", name: "  Оля " });
		assert.equal(r.ok, true);
		assert.deepEqual(r.msg, { v: 1, type: "join", room: "calm", name: "Оля" });
	});

	it("правильні chat і leave", () => {
		assert.equal(
			validate({ v: 1, type: "chat", text: " привіт " }).msg.text,
			"привіт",
		);
		assert.equal(validate({ v: 1, type: "leave" }).ok, true);
	});

	it("не об'єкт, чужа версія, немає type: BAD_FORMAT", () => {
		for (const raw of [
			null,
			5,
			"x",
			[],
			{},
			{ v: 2, type: "chat", text: "a" },
			{ v: 1 },
			{ v: 1, type: 5 },
		]) {
			const r = validate(raw);
			assert.equal(r.ok, false, JSON.stringify(raw));
			assert.equal(r.code, CLOSE.BAD_FORMAT, JSON.stringify(raw));
		}
	});

	it("невідомий type, зокрема з прототипа: UNKNOWN_TYPE", () => {
		for (const type of ["dance", "toString", "__proto__", "constructor"]) {
			const r = validate({ v: 1, type });
			assert.equal(r.code, CLOSE.UNKNOWN_TYPE, type);
		}
	});

	it("зламана форма: зайве чи відсутнє поле, погані значення", () => {
		const bad = [
			{ v: 1, type: "join", room: "calm" },
			{ v: 1, type: "join", room: "calm", name: "A", admin: true },
			{ v: 1, type: "join", room: "a b", name: "A" },
			{ v: 1, type: "join", room: "calm", name: "" },
			{ v: 1, type: "join", room: "calm", name: "x".repeat(17) },
			{ v: 1, type: "join", room: "calm", name: "A\nB" },
			{ v: 1, type: "chat", text: "   " },
			{ v: 1, type: "chat", text: "x".repeat(201) },
			{ v: 1, type: "chat", text: 5 },
			{ v: 1, type: "leave", extra: 1 },
		];
		for (const raw of bad) {
			const r = validate(raw);
			assert.equal(r.ok, false, JSON.stringify(raw));
			assert.equal(r.code, CLOSE.BAD_FORMAT, JSON.stringify(raw));
		}
	});
});

describe("validate: input", () => {
	it("правильний input проходить без змін", () => {
		const r = validate({ ...INPUT });
		assert.equal(r.ok, true);
		assert.deepEqual(r.msg, INPUT);
	});

	it("seq: межі Uint32", () => {
		assert.equal(validate({ ...INPUT, seq: 0 }).ok, true);
		assert.equal(validate({ ...INPUT, seq: 0xffffffff }).ok, true);
	});

	it("зламаний input: BAD_FORMAT", () => {
		const { up: _up, ...noUp } = INPUT;
		const bad = [
			noUp, // немає ключа
			{ ...INPUT, turn: 1000 }, // зайве поле
			{ ...INPUT, seq: -1 },
			{ ...INPUT, seq: 1.5 },
			{ ...INPUT, seq: "1" },
			{ ...INPUT, seq: null },
			{ ...INPUT, seq: 0x100000000 },
			{ ...INPUT, seq: Number.NaN },
			{ ...INPUT, right: 1 },
			{ ...INPUT, fire: "true" },
			{ ...INPUT, up: null },
		];
		for (const raw of bad) {
			const r = validate(raw);
			assert.equal(r.ok, false, JSON.stringify(raw));
			assert.equal(r.code, CLOSE.BAD_FORMAT, JSON.stringify(raw));
		}
	});
});

describe("validate: ping", () => {
	it("правильний ping", () => {
		const r = validate({ v: 1, type: "ping", t: 12.5 });
		assert.equal(r.ok, true);
		assert.deepEqual(r.msg, { v: 1, type: "ping", t: 12.5 });
	});

	it("зламаний ping: BAD_FORMAT", () => {
		const bad = [
			{ v: 1, type: "ping" },
			{ v: 1, type: "ping", t: -1 },
			{ v: 1, type: "ping", t: Number.POSITIVE_INFINITY },
			{ v: 1, type: "ping", t: Number.NaN },
			{ v: 1, type: "ping", t: "5" },
			{ v: 1, type: "ping", t: 1, extra: true },
		];
		for (const raw of bad) {
			const r = validate(raw);
			assert.equal(r.ok, false, JSON.stringify(raw));
			assert.equal(r.code, CLOSE.BAD_FORMAT, JSON.stringify(raw));
		}
	});
});
