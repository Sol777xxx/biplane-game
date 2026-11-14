import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	binary,
	CodecError,
	decodeInput,
	decodeSnapshot,
	encodeInput,
	encodeSnapshot,
	FORMAT_VERSION,
	FRAME,
	frameType,
	PICKUP_TYPES as WIRE_PICKUPS,
} from "../codec/binary.js";
import { CODECS, getCodec } from "../codec/index.js";
import { json } from "../codec/json.js";
import { INPUT_KEYS, MAX_SEQ, make } from "../protocol/index.js";
import { PICKUP_TYPES } from "../sim/objects.ts";
import { createScenario } from "../sim/scenario.js";
import { eventToWire, takeSnapshot } from "../sim/snapshot.js";

// те, що побачив би клієнт після JSON (зокрема «-0» стає 0)
const viaJson = (m) => JSON.parse(JSON.stringify(m));
const copy = (bytes) => Uint8Array.from(bytes);
const near = (a, b, eps) =>
	assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b} (±${eps})`);

describe("бінарний input", () => {
	it("розкладка: 7 байт, little-endian, біти клавіш", () => {
		const bytes = encodeInput(0x01020304, { right: true, fire: true });
		assert.deepEqual([...bytes], [1, 1, 4, 3, 2, 1, 8 | 16]);
	});

	it("round-trip усіх 32 комбінацій клавіш і меж seq", () => {
		for (const seq of [0, 1, 255, 65536, MAX_SEQ]) {
			for (let mask = 0; mask < 32; mask++) {
				const keys = Object.fromEntries(
					INPUT_KEYS.map((k, i) => [k, Boolean(mask & (1 << i))]),
				);
				assert.deepEqual(decodeInput(encodeInput(seq, keys)), {
					v: 1,
					type: "input",
					seq,
					...keys,
				});
			}
		}
	});

	it("seq поза межами обмежується", () => {
		assert.equal(decodeInput(encodeInput(-5, {})).seq, 0);
		assert.equal(decodeInput(encodeInput(2 ** 40, {})).seq, MAX_SEQ);
		assert.equal(decodeInput(encodeInput(Number.NaN, {})).seq, 0);
	});

	it("зламані кадри це CodecError", () => {
		const good = copy(encodeInput(1, {}));
		const set = (i, v) => {
			const b = copy(good);
			b[i] = v;
			return b;
		};
		const bad = [
			new Uint8Array(0),
			good.subarray(0, 6),
			Uint8Array.of(...good, 0),
			set(0, 2), // версія
			set(1, 2), // тип
			set(6, 0x20), // зарезервований біт
		];
		for (const frame of bad) {
			assert.throws(() => decodeInput(frame), CodecError, [...frame].join());
		}
	});

	it("приймає ArrayBuffer і зсунутий Uint8Array (Buffer із пулу)", () => {
		const good = encodeInput(9, { up: true });
		const expected = decodeInput(good);
		assert.deepEqual(decodeInput(good.buffer), expected);
		const padded = new Uint8Array(20);
		padded.set(good, 5);
		assert.deepEqual(decodeInput(padded.subarray(5, 12)), expected);
	});

	it("frameType: версія й тип, коротший кадр це null", () => {
		assert.deepEqual(frameType(Uint8Array.of(1, 2, 9)), {
			version: 1,
			type: 2,
		});
		assert.equal(frameType(Uint8Array.of(1)), null);
		assert.throws(() => frameType("рядок"), CodecError);
	});
});

// ---------- знімок ----------
const SHIP = (id, player) => ({
	id,
	player,
	x: 100.25,
	y: 200.5,
	vx: -3.5,
	vy: 4,
	pitch: 0.1235,
	facing: -1,
	hp: 66,
	cooldown: 0.28,
	shield: 1.5,
	rapid: 0,
	homing: 0.25,
});

// повний набір розділів: довжина кадру відома наперед (217 байт)
const layoutMsg = () =>
	make("snapshot", {
		tick: 0x01020304,
		ack: 0x0a0b0c0d,
		players: [{ id: "a", score: 1, destroyed: 2, crashes: 3, deaths: 4 }],
		ships: [SHIP(7, "a")],
		obstacles: [
			{ id: 5, x: 300.5, y: 400.5, vx: 50.25, vy: -60.75, r: 70 },
			{ id: 6, x: 1, y: 2, vx: 0, vy: 0, r: 45 },
		],
		pickups: [{ id: 8, type: "rapid", x: 1000.5, y: 500.5, life: 0.75 }],
		bullets: [1, 2, 3].map((n) => ({
			id: 10 + n,
			owner: n === 2 ? null : "a",
			seq: n,
			x: 10.5,
			y: 20.5,
			vx: 700,
			vy: -2.25,
			ttl: 1.234,
		})),
		events: [
			{ type: "fired", player: "a", x: 1, y: 2 },
			{
				type: "exploded",
				kind: "obstacle",
				x: 3,
				y: 4,
				size: 45,
				color: "storm",
				count: 26,
			},
		],
	});

const EVENTS = [
	{ type: "fired", player: "a", x: -50, y: 1700 },
	{ type: "hit", kind: "biplane", x: 10, y: 20 },
	{ type: "hit", kind: "obstacle", x: 10, y: 20 },
	{
		type: "exploded",
		kind: "biplane",
		x: 5,
		y: 6,
		size: 46,
		color: "pink",
		count: 50,
	},
	{ type: "scored", player: "b", delta: 70, x: 7, y: 8 },
	{ type: "pickup", player: "a", pickup: "homing" },
	{ type: "crash", player: null, x: 9, y: 10 },
	{ type: "respawned", player: "b", x: 11, y: 12 },
];

const players = (...ids) =>
	ids.map((id) => ({ id, score: 0, destroyed: 0, crashes: 0, deaths: 0 }));
const empty = (extra) =>
	make("snapshot", {
		tick: 1,
		ack: 0,
		players: [],
		ships: [],
		obstacles: [],
		pickups: [],
		bullets: [],
		events: [],
		...extra,
	});

describe("бінарний знімок: розкладка", () => {
	it("довжина кадру збігається зі специфікацією", () => {
		assert.equal(encodeSnapshot(layoutMsg()).byteLength, 217);
	});

	it("заголовок і таблиця гравців", () => {
		const b = encodeSnapshot(layoutMsg());
		assert.deepEqual([...b.subarray(0, 2)], [FORMAT_VERSION, FRAME.SNAPSHOT]);
		assert.deepEqual([...b.subarray(2, 6)], [4, 3, 2, 1]); // tick, little-endian
		assert.deepEqual([...b.subarray(6, 10)], [0x0d, 0x0c, 0x0b, 0x0a]); // ack
		assert.deepEqual([...b.subarray(10, 17)], [1, 1, 2, 1, 3, 0, 2]); // кількості
		assert.deepEqual([...b.subarray(17, 20)], [1, 0x61, 1]); // довжина id, "a", score
	});

	it("зсуви розділів: корабель, бонус, куля без власника, події", () => {
		const b = encodeSnapshot(layoutMsg());
		assert.deepEqual([...b.subarray(29, 33)], [7, 0, 0, 0]); // id корабля
		assert.equal(b[33], 0); // індекс гравця "a"
		assert.equal(b[110], 1); // тип бонусу rapid
		assert.equal(b[151], 255); // власник другої кулі: немає
		assert.equal(b[201], 1); // перша подія: fired
		assert.equal(b[207], 3); // друга подія: exploded
	});

	it("таблиці збігаються зі спільним кодом", () => {
		assert.deepEqual([...WIRE_PICKUPS], PICKUP_TYPES);
	});
});

describe("бінарний знімок: round-trip", () => {
	it("ручне повідомлення повертається без змін", () => {
		const msg = layoutMsg();
		assert.deepStrictEqual(decodeSnapshot(encodeSnapshot(msg)), viaJson(msg));
	});

	it("усі типи подій і гравці з UTF-8 (2 і 4 байти на символ)", () => {
		const msg = empty({
			players: players("a", "Оля", "😀x", "b"),
			events: EVENTS,
		});
		assert.deepStrictEqual(decodeSnapshot(encodeSnapshot(msg)), viaJson(msg));
	});

	it("кожен знімок реальної гри збігається з JSON-варіантом точно", () => {
		const sc = createScenario({ seed: 4, players: 3 });
		const events = [];
		for (const type of Object.keys({
			fired: 1,
			hit: 1,
			exploded: 1,
			scored: 1,
			pickup: 1,
			crash: 1,
			respawned: 1,
		})) {
			sc.game.world.bus.addEventListener(type, (e) => {
				const wire = eventToWire(type, e.detail);
				if (wire) events.push(wire);
			});
		}
		let bullets = 0;
		let evs = 0;
		for (let i = 0; i < 400; i++) {
			sc.step();
			const msg = make("snapshot", {
				...takeSnapshot(sc.game),
				events: events.splice(0),
				ack: i,
			});
			bullets += msg.bullets.length;
			evs += msg.events.length;
			assert.deepStrictEqual(
				decodeSnapshot(encodeSnapshot(msg)),
				viaJson(msg),
				`тік ${msg.tick}`,
			);
		}
		assert.ok(bullets > 0 && evs > 0, `куль ${bullets}, подій ${evs}`);
	});

	it("довільні числа квантуються в межах заявленої точності", () => {
		const msg = empty({
			players: players("a"),
			ships: [
				{
					...SHIP(1, "a"),
					x: 123.456789,
					y: 700.123456,
					vx: -12.3456,
					vy: 0.004,
					pitch: 0.123456,
					facing: 1,
					cooldown: 0.2799,
					shield: 5.678,
				},
			],
		});
		const [s] = decodeSnapshot(encodeSnapshot(msg)).ships;
		near(s.x, 123.456789, 0.0051);
		near(s.y, 700.123456, 0.0051);
		near(s.vx, -12.3456, 0.0051);
		near(s.vy, 0.004, 0.0051);
		near(s.pitch, 0.123456, 0.00005);
		near(s.cooldown, 0.2799, 0.0005);
		near(s.shield, 5.678, 0.0051);
		assert.equal(s.facing, 1);
	});

	it("значення поза діапазоном обмежуються, NaN це 0, винятків немає", () => {
		const msg = empty({
			players: players("a"),
			ships: [
				{
					...SHIP(1, "a"),
					pitch: 10,
					hp: 300,
					cooldown: -1,
					x: Number.NaN,
					shield: 1e9,
				},
			],
		});
		const [s] = decodeSnapshot(encodeSnapshot(msg)).ships;
		assert.equal(s.pitch, 3.2767);
		assert.equal(s.hp, 255);
		assert.equal(s.cooldown, 0);
		assert.equal(s.x, 0);
		assert.equal(s.shield, 655.35);
	});

	it("невідоме пропускається: події, бонуси; корабель невідомого гравця без власника", () => {
		const msg = empty({
			players: players("a"),
			ships: [SHIP(1, "ghost")],
			pickups: [
				{ id: 2, type: "laser", x: 1, y: 2, life: 1 },
				{ id: 3, type: "shield", x: 1, y: 2, life: 1 },
			],
			events: [
				{ type: "dance" },
				{ type: "toString" },
				null,
				{ type: "hit", kind: "plane", x: 1, y: 2 },
				{
					type: "exploded",
					kind: "biplane",
					x: 1,
					y: 2,
					size: 1,
					color: "green",
					count: 1,
				},
				{ type: "pickup", player: "a", pickup: "laser" },
				{ type: "fired", player: "a", x: 1, y: 2 },
			],
		});
		const out = decodeSnapshot(encodeSnapshot(msg));
		assert.deepEqual(
			out.events.map((e) => e.type),
			["fired"],
		);
		assert.deepEqual(
			out.pickups.map((p) => p.id),
			[3],
		);
		assert.equal(out.ships[0].player, null);
	});

	it("понад 255 гравців обрізається без винятків", () => {
		const ids = Array.from({ length: 300 }, (_, i) => `p${i}`);
		const out = decodeSnapshot(
			encodeSnapshot(empty({ players: players(...ids) })),
		);
		assert.equal(out.players.length, 255);
	});
});

describe("бінарний знімок: декодер суворий", () => {
	const good = () => copy(encodeSnapshot(layoutMsg()));
	const set = (i, v) => {
		const b = good();
		b[i] = v;
		return b;
	};

	it("будь-який обрізаний кадр це CodecError", () => {
		const bytes = good();
		for (let n = 0; n < bytes.length; n++) {
			assert.throws(
				() => decodeSnapshot(bytes.subarray(0, n)),
				CodecError,
				`довжина ${n}`,
			);
		}
	});

	it("зайві байти, чужа версія, чужий тип", () => {
		assert.throws(
			() => decodeSnapshot(Uint8Array.of(...good(), 0)),
			CodecError,
		);
		assert.throws(() => decodeSnapshot(set(0, 2)), CodecError);
		assert.throws(() => decodeSnapshot(set(1, 1)), CodecError);
	});

	it("індекс гравця: 255 це «немає», 7 при одному гравці це помилка", () => {
		assert.equal(decodeSnapshot(set(33, 255)).ships[0].player, null);
		assert.throws(() => decodeSnapshot(set(33, 7)), CodecError);
	});

	it("невідомий тип бонусу, код події, зарезервовані біти, поганий UTF-8", () => {
		assert.throws(() => decodeSnapshot(set(110, 9)), CodecError);
		assert.throws(() => decodeSnapshot(set(201, 99)), CodecError);
		assert.throws(() => decodeSnapshot(set(61, 2)), CodecError);
		assert.throws(() => decodeSnapshot(set(18, 0xff)), CodecError);
	});

	it("не бінарні дані це CodecError, а не TypeError", () => {
		assert.throws(() => decodeSnapshot("{}"), CodecError);
		assert.throws(() => decodeSnapshot(null), CodecError);
	});
});

describe("кодеки", () => {
	it("реєстр: невідоме ім'я це json", () => {
		assert.equal(getCodec("binary"), binary);
		assert.equal(getCodec("json"), json);
		for (const name of [
			"xml",
			"",
			null,
			undefined,
			5,
			"toString",
			"__proto__",
		]) {
			assert.equal(getCodec(name), json, String(name));
		}
		assert.deepEqual(Object.keys(CODECS).sort(), ["binary", "json"]);
	});

	it("json-кодек: знімок і input туди й назад, рядок або байти", () => {
		const msg = layoutMsg();
		const text = json.encodeSnapshot(msg);
		assert.equal(typeof text, "string");
		assert.deepEqual(json.decodeSnapshot(text), viaJson(msg));
		assert.deepEqual(
			json.decodeSnapshot(new TextEncoder().encode(text)),
			viaJson(msg),
		);
		const input = json.decodeInput(json.encodeInput(5, { right: true }));
		assert.deepEqual(input, {
			v: 1,
			type: "input",
			seq: 5,
			up: false,
			down: false,
			left: false,
			right: true,
			fire: false,
		});
	});

	it("обидва кодеки дають однаковий input і однаковий знімок", () => {
		const keys = { up: true, fire: true };
		assert.deepEqual(
			binary.decodeInput(binary.encodeInput(7, keys)),
			json.decodeInput(json.encodeInput(7, keys)),
		);
		const msg = layoutMsg();
		assert.deepStrictEqual(
			binary.decodeSnapshot(binary.encodeSnapshot(msg)),
			json.decodeSnapshot(json.encodeSnapshot(msg)),
		);
	});

	it("бінарний знімок помітно менший за JSON", () => {
		const msg = layoutMsg();
		assert.ok(
			binary.encodeSnapshot(msg).byteLength * 2 <
				new TextEncoder().encode(json.encodeSnapshot(msg)).length,
		);
	});
});
