import assert from "node:assert/strict";
import * as fc from "fast-check";
import { describe, it } from "vitest";
import {
	CodecError,
	decodeInput,
	decodeSnapshot,
	encodeInput,
	encodeSnapshot,
} from "../codec/binary.ts";
import {
	INPUT_KEYS,
	MAX_SEQ,
	make,
	NETSIM_LIMITS,
	parseClientMessage,
} from "../protocol/index.ts";
import { ARENA } from "../sim/arena.ts";
import { createScenario } from "../sim/scenario.ts";
import { takeSnapshot } from "../sim/snapshot.ts";

// ---------- генератори ----------
const keys = fc.record({
	up: fc.boolean(),
	down: fc.boolean(),
	left: fc.boolean(),
	right: fc.boolean(),
	fire: fc.boolean(),
});
const seq = fc.integer({ min: 0, max: MAX_SEQ });

// світ для знімка: справжня симуляція, тож значення завжди відповідають схемі протоколу
const world = fc.record({
	seed: fc.integer({ min: 1, max: 100_000 }),
	players: fc.integer({ min: 1, max: 6 }),
	ticks: fc.integer({ min: 1, max: 300 }),
});
const coord = fc.integer({ min: -32768, max: 32767 });
const u16 = fc.integer({ min: 0, max: 65535 });
const arbEvent = (ids) => {
	const player = fc.constantFrom(...ids);
	const maybe = fc.option(player, { nil: null });
	const kind = fc.constantFrom("biplane", "obstacle");
	return fc.oneof(
		fc.record({
			type: fc.constant("fired"),
			player: maybe,
			x: coord,
			y: coord,
		}),
		fc.record({ type: fc.constant("hit"), kind, x: coord, y: coord }),
		fc.record({
			type: fc.constant("exploded"),
			kind,
			x: coord,
			y: coord,
			size: u16,
			color: fc.constantFrom("pink", "storm"),
			count: fc.integer({ min: 0, max: 255 }),
		}),
		fc.record({
			type: fc.constant("scored"),
			player,
			delta: u16,
			x: coord,
			y: coord,
		}),
		fc.record({
			type: fc.constant("pickup"),
			player: maybe,
			pickup: fc.constantFrom("shield", "rapid", "homing"),
		}),
		fc.record({
			type: fc.constant("crash"),
			player: maybe,
			x: coord,
			y: coord,
		}),
		fc.record({ type: fc.constant("respawned"), player, x: coord, y: coord }),
	);
};

// повідомлення-знімок: стан симуляції + довільні ack і події (гравці в подіях з цього знімка)
const arbMessage = world.chain((w) => {
	const scenario = createScenario(w);
	for (let i = 0; i < w.ticks; i++) scenario.step();
	const snap = takeSnapshot(scenario.game);
	const ids = snap.players.map((p) => p.id);
	return fc.record({
		snap: fc.constant(snap),
		ack: seq,
		events: fc.array(arbEvent(ids), { maxLength: 10 }),
	});
});

const message = ({ snap, ack, events }) =>
	make("snapshot", { ...snap, ack, events });

const viaJson = (m) => JSON.parse(JSON.stringify(m));

// кодувальник зберігає кут з кроком 1e-4: решта полів має збігтися точно
const PITCH_STEP = 1e-4;
function assertSameWithinQuantum(decoded, original) {
	const a = viaJson(decoded);
	const b = viaJson(original);
	assert.equal(a.ships.length, b.ships.length);
	for (let i = 0; i < a.ships.length; i++) {
		const d = Math.abs(a.ships[i].pitch - b.ships[i].pitch);
		assert.ok(
			d <= PITCH_STEP / 2 + 1e-9,
			`кут: ${a.ships[i].pitch} проти ${b.ships[i].pitch}`,
		);
		a.ships[i].pitch = b.ships[i].pitch;
	}
	assert.deepEqual(a, b);
}

// довжина кадру за описом формату (коментар у shared/codec/binary.ts)
const EVENT_BYTES = {
	fired: 6,
	hit: 6,
	exploded: 10,
	scored: 8,
	pickup: 3,
	crash: 6,
	respawned: 6,
};
const HEADER = 17;
const specLength = (m) =>
	HEADER +
	m.players.reduce(
		(n, p) => n + 11 + new TextEncoder().encode(p.id).length,
		0,
	) +
	33 * m.ships.length +
	22 * m.obstacles.length +
	14 * m.pickups.length +
	27 * m.bullets.length +
	m.events.reduce((n, e) => n + EVENT_BYTES[e.type], 0);

// кодек може лише повернути значення або кинути CodecError: інакше це баг
function onlyCodecError(fn) {
	try {
		return fn();
	} catch (error) {
		assert.ok(error instanceof CodecError, `не CodecError: ${String(error)}`);
		return undefined;
	}
}

describe("fast-check: кодек", () => {
	it("input: decode(encode(seq, keys)) повертає те саме повідомлення", () => {
		fc.assert(
			fc.property(seq, keys, (s, k) => {
				assert.deepEqual(decodeInput(encodeInput(s, k)), {
					v: 1,
					type: "input",
					seq: s,
					...k,
				});
			}),
			{ numRuns: 300 },
		);
	});

	it("знімок: після декодування те саме повідомлення, кут з точністю до кроку квантування", () => {
		fc.assert(
			fc.property(arbMessage, (parts) => {
				const m = message(parts);
				assertSameWithinQuantum(decodeSnapshot(encodeSnapshot(m)), m);
			}),
			{ numRuns: 60 },
		);
	});

	it("знімок: довжина кадру збігається з описом формату", () => {
		fc.assert(
			fc.property(arbMessage, (parts) => {
				const m = message(parts);
				assert.equal(encodeSnapshot(m).length, specLength(m));
			}),
			{ numRuns: 60 },
		);
	});

	it("випадкові байти: або повідомлення, або CodecError, ніколи інший виняток", () => {
		fc.assert(
			fc.property(fc.uint8Array({ maxLength: 300 }), (bytes) => {
				onlyCodecError(() => decodeSnapshot(bytes));
				onlyCodecError(() => decodeInput(bytes));
			}),
			{ numRuns: 500 },
		);
	});

	it("зіпсований справжній кадр: обрізаний чи з зайвим байтом це CodecError, зі зміненим байтом не падає", () => {
		fc.assert(
			fc.property(
				arbMessage,
				fc.nat(1_000_000),
				fc.integer({ min: 0, max: 255 }),
				(parts, pick, value) => {
					const frame = encodeSnapshot(message(parts));
					const cut = pick % frame.length;
					assert.throws(
						() => decodeSnapshot(frame.subarray(0, cut)),
						CodecError,
					);
					assert.throws(
						() => decodeSnapshot(Uint8Array.of(...frame, value)),
						CodecError,
					);
					const flipped = Uint8Array.from(frame);
					flipped[pick % frame.length] = value;
					onlyCodecError(() => decodeSnapshot(flipped));
				},
			),
			{ numRuns: 60 },
		);
	});
});

describe("fast-check: симуляція", () => {
	it("після 1000 випадкових кроків кожен корабель усередині арени", () => {
		const masks = fc.array(fc.integer({ min: 0, max: 31 }), {
			minLength: 1000,
			maxLength: 1000,
		});
		fc.assert(
			fc.property(
				fc.integer({ min: 1, max: 100_000 }),
				fc.integer({ min: 1, max: 3 }),
				masks,
				(seed, players, ms) => {
					const { game } = createScenario({ seed, players });
					const ids = Array.from({ length: players }, (_, i) => `p${i}`);
					for (const m of ms) {
						const inputs = new Map(
							ids.map((id, i) => [
								id,
								Object.fromEntries(
									INPUT_KEYS.map((k, b) => [
										k,
										Boolean((m >> ((b + i) % 5)) & 1),
									]),
								),
							]),
						);
						game.step(1 / 30, inputs);
						for (const s of takeSnapshot(game).ships) {
							assert.ok(s.x >= 0 && s.x <= ARENA.width, `x = ${s.x}`);
							assert.ok(s.y >= 0 && s.y <= ARENA.height, `y = ${s.y}`);
						}
					}
				},
			),
			{ numRuns: 8 },
		);
	});
});

// ---------- розбір повідомлень ----------
const word = fc
	.array(fc.constantFrom(..."abcxyzABCXYZ0189_-".split("")), {
		minLength: 1,
		maxLength: 32,
	})
	.map((a) => a.join(""));
const printable = (max) =>
	fc
		.string({ minLength: 1, maxLength: max })
		.filter(
			(s) =>
				s.trim().length >= 1 && s.trim().length <= max && !/\p{Cc}/u.test(s),
		);
const validMessage = fc.oneof(
	fc.record({
		v: fc.constant(1),
		type: fc.constant("join"),
		room: word,
		name: printable(16),
	}),
	fc.record({
		v: fc.constant(1),
		type: fc.constant("chat"),
		text: printable(200),
	}),
	fc.record({ v: fc.constant(1), type: fc.constant("leave") }),
	fc.tuple(seq, keys).map(([s, k]) => ({ v: 1, type: "input", seq: s, ...k })),
	fc.record({
		v: fc.constant(1),
		type: fc.constant("ping"),
		t: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
	}),
	fc.record({
		v: fc.constant(1),
		type: fc.constant("netsim"),
		lag: fc.integer({ min: NETSIM_LIMITS.lag[0], max: NETSIM_LIMITS.lag[1] }),
		jitter: fc.integer({
			min: NETSIM_LIMITS.jitter[0],
			max: NETSIM_LIMITS.jitter[1],
		}),
		loss: fc.integer({
			min: NETSIM_LIMITS.loss[0],
			max: NETSIM_LIMITS.loss[1],
		}),
	}),
);

describe("fast-check: parseClientMessage", () => {
	it("приймає кожне згенероване правильне повідомлення (текст обрізається по краях)", () => {
		fc.assert(
			fc.property(validMessage, (m) => {
				const r = parseClientMessage(m);
				assert.equal(r.ok, true, JSON.stringify(m));
				const expected = { ...m };
				if ("name" in m) expected.name = m.name.trim();
				if ("text" in m) expected.text = m.text.trim();
				assert.deepEqual(r.msg, expected);
			}),
			{ numRuns: 400 },
		);
	});

	it("відхиляє кожну мутацію: зайве поле, пропущене поле, чужа версія, невідомий тип", () => {
		const badValue = fc.constantFrom(null, {}, [], Number.NaN);
		fc.assert(
			fc.property(
				validMessage,
				fc.nat(1000),
				fc.integer({ min: 2, max: 1000 }),
				fc.constantFrom(
					"toString",
					"__proto__",
					"constructor",
					"hasOwnProperty",
					"nope",
				),
				badValue,
				(m, pick, version, type, bad) => {
					const fields = Object.keys(m);
					const field = fields[pick % fields.length];
					const dropped = Object.fromEntries(
						Object.entries(m).filter(([k]) => k !== field),
					);
					assert.equal(
						parseClientMessage({ ...m, extra: 1 }).ok,
						false,
						"зайве поле",
					);
					assert.equal(parseClientMessage(dropped).ok, false, `без ${field}`);
					assert.equal(
						parseClientMessage({ ...m, v: version }).ok,
						false,
						"версія",
					);
					assert.equal(
						parseClientMessage({ ...m, type }).ok,
						false,
						`тип ${type}`,
					);
					assert.equal(
						parseClientMessage({ ...m, [field]: bad }).ok,
						false,
						`${field} = ${String(bad)}`,
					);
				},
			),
			{ numRuns: 400 },
		);
	});

	it("не об'єкт на вході (null, число, рядок, масив) це відмова, а не виняток", () => {
		fc.assert(
			fc.property(
				fc.oneof(
					fc.constant(null),
					fc.integer(),
					fc.string(),
					fc.boolean(),
					fc.array(fc.integer()),
				),
				(raw) => {
					assert.equal(parseClientMessage(raw).ok, false);
				},
			),
			{ numRuns: 200 },
		);
	});
});
