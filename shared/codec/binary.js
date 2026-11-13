import { INPUT_KEYS, MAX_SEQ, make } from "../protocol/index.js";

// Бінарний протокол v1, little-endian скрізь. Кадр: u8 версія · u8 тип · тіло.
//
// INPUT (клієнт → сервер), 7 байт:
//   u32 seq · u8 клавіші (біти: up 1, down 2, left 4, right 8, fire 16; решта 0)
//
// SNAPSHOT (сервер → клієнт):
//   u32 tick · u32 ack · u8 nPlayers · u8 nShips · u8 nObstacles · u8 nPickups
//   · u16 nBullets · u8 nEvents; далі по черзі: гравці, кораблі, хмарки, бонуси, кулі, події
//   player   u8 довжина · id (UTF-8) · u32 score · u16 destroyed · u16 crashes · u16 deaths
//   ship     u32 id · u8 гравець · f32 x y vx vy · i16 pitch (×10⁴ рад) · u16 cooldown (мс)
//            · u16 shield rapid homing (×100 с) · u8 hp · u8 прапори (біт 0: facing вправо)
//   obstacle u32 id · f32 x y vx vy · u16 радіус
//   pickup   u32 id · u8 тип · f32 x y · u8 life (×100)
//   bullet   u32 id · u8 власник · u32 seq · f32 x y vx vy · u16 ttl (мс)
//   event    u8 код і поля (x, y це i16, px):
//            1 fired: u8 гравець, x, y · 2 hit: u8 вид, x, y
//            3 exploded: u8 вид, x, y, u16 size, u8 колір, u8 count
//            4 scored: u8 гравець, u16 delta, x, y · 5 pickup: u8 гравець, u8 тип
//            6 crash, 7 respawned: u8 гравець, x, y
// Гравець у ship, bullet і event це індекс у таблиці гравців знімка; 255 це «немає».
// Дробові значення декодер округлює до 0.01, як JSON-знімок: обидва кодеки дають однакові
// об'єкти. Id сутностей u32: лічильник росте всю гру, u16 переповнився б.
// Кодувальник не кидає винятків на даних гри (обрізає, обмежує, пропускає невідоме);
// декодер суворий і кидає CodecError на будь-якому відхиленні від розкладки.

export const FORMAT_VERSION = 1;
export const FRAME = Object.freeze({ INPUT: 1, SNAPSHOT: 2 });
export const NONE = 255;
export const PICKUP_TYPES = Object.freeze(["shield", "rapid", "homing"]);
export const ENTITY_KINDS = Object.freeze(["biplane", "obstacle"]);
export const COLORS = Object.freeze(["pink", "storm"]);

const HEADER = 17;
const INPUT_SIZE = 7;
const INPUT_MASK = (1 << INPUT_KEYS.length) - 1;
const MAX_U32 = 0xffffffff;
const SHIP = 33;
const OBSTACLE = 22;
const PICKUP = 14;
const BULLET = 27;
const PLAYER_FIXED = 11; // довжина id (1) + score (4) + три u16
const EVENT_MAX = 10;
const EVENT_CODE = {
	fired: 1,
	hit: 2,
	exploded: 3,
	scored: 4,
	pickup: 5,
	crash: 6,
	respawned: 7,
};

const encoder = new TextEncoder();
const utf8 = new TextDecoder("utf-8", { fatal: true });

export class CodecError extends Error {
	constructor(message) {
		super(message);
		this.name = "CodecError";
	}
}

function toBytes(input) {
	if (input instanceof Uint8Array) return input; // зокрема Buffer
	if (ArrayBuffer.isView(input)) {
		return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
	}
	if (input instanceof ArrayBuffer) return new Uint8Array(input);
	throw new CodecError("очікується ArrayBuffer або Uint8Array");
}

const fin = (v) => (Number.isFinite(v) ? v : 0);
const clampInt = (v, lo, hi, scale = 1) =>
	Math.min(hi, Math.max(lo, Math.round(fin(v) * scale)));
const px = (v) => clampInt(v, -32768, 32767);
const r2 = (v) => Math.round(v * 100) / 100 + 0; // +0 прибирає «-0», як після JSON

class Writer {
	constructor(size) {
		this.bytes = new Uint8Array(size);
		this.view = new DataView(this.bytes.buffer);
		this.o = 0;
	}

	u8(v) {
		this.view.setUint8(this.o, v);
		this.o += 1;
	}

	i16(v) {
		this.view.setInt16(this.o, v, true);
		this.o += 2;
	}

	u16(v) {
		this.view.setUint16(this.o, v, true);
		this.o += 2;
	}

	u32(v) {
		this.view.setUint32(this.o, v, true);
		this.o += 4;
	}

	f32(v) {
		this.view.setFloat32(this.o, v, true);
		this.o += 4;
	}

	raw(bytes) {
		this.bytes.set(bytes, this.o);
		this.o += bytes.length;
	}

	done() {
		return this.bytes.subarray(0, this.o);
	}
}

class Reader {
	constructor(input) {
		this.bytes = toBytes(input);
		this.view = new DataView(
			this.bytes.buffer,
			this.bytes.byteOffset,
			this.bytes.byteLength,
		);
		this.o = 0;
	}

	get length() {
		return this.bytes.length;
	}

	// резервує n байтів і повертає зсув їхнього початку
	take(n) {
		if (this.o + n > this.bytes.length) throw new CodecError("кадр обірвано");
		const at = this.o;
		this.o += n;
		return at;
	}

	u8() {
		return this.view.getUint8(this.take(1));
	}

	i16() {
		return this.view.getInt16(this.take(2), true);
	}

	u16() {
		return this.view.getUint16(this.take(2), true);
	}

	u32() {
		return this.view.getUint32(this.take(4), true);
	}

	f32() {
		return this.view.getFloat32(this.take(4), true);
	}

	text(n) {
		const at = this.take(n);
		try {
			return utf8.decode(this.bytes.subarray(at, at + n));
		} catch {
			throw new CodecError("некоректний UTF-8");
		}
	}
}

function pick(table, i) {
	if (i >= table.length) throw new CodecError("невідоме значення");
	return table[i];
}

const list = (n, read) => Array.from({ length: n }, read);

// ---------- input ----------
export function encodeInput(seq, keys) {
	const w = new Writer(INPUT_SIZE);
	w.u8(FORMAT_VERSION);
	w.u8(FRAME.INPUT);
	w.u32(clampInt(seq, 0, MAX_SEQ));
	let mask = 0;
	INPUT_KEYS.forEach((key, i) => {
		if (keys?.[key]) mask |= 1 << i;
	});
	w.u8(mask);
	return w.done();
}

// повертає те саме повідомлення, що й validate() для JSON-input
export function decodeInput(input) {
	const r = new Reader(input);
	if (r.length !== INPUT_SIZE)
		throw new CodecError("input: неправильна довжина");
	if (r.u8() !== FORMAT_VERSION) throw new CodecError("непідтримувана версія");
	if (r.u8() !== FRAME.INPUT) throw new CodecError("це не input");
	const seq = r.u32();
	const mask = r.u8();
	if (mask & ~INPUT_MASK) throw new CodecError("input: зарезервовані біти");
	const msg = make("input", { seq });
	INPUT_KEYS.forEach((key, i) => {
		msg[key] = Boolean(mask & (1 << i));
	});
	return msg;
}

// { version, type } з перших двох байтів, або null, якщо кадр коротший
export function frameType(input) {
	const b = toBytes(input);
	return b.length >= 2 ? { version: b[0], type: b[1] } : null;
}

// ---------- snapshot: кодування ----------
function encodable(e) {
	if (!e || !Object.hasOwn(EVENT_CODE, e.type)) return false;
	if (e.type === "hit") return ENTITY_KINDS.includes(e.kind);
	if (e.type === "exploded") {
		return ENTITY_KINDS.includes(e.kind) && COLORS.includes(e.color);
	}
	if (e.type === "pickup") return PICKUP_TYPES.includes(e.pickup);
	return true;
}

function writeEvent(w, e, at) {
	w.u8(EVENT_CODE[e.type]);
	switch (e.type) {
		case "fired":
		case "crash":
		case "respawned":
			w.u8(at(e.player));
			w.i16(px(e.x));
			w.i16(px(e.y));
			break;
		case "hit":
			w.u8(ENTITY_KINDS.indexOf(e.kind));
			w.i16(px(e.x));
			w.i16(px(e.y));
			break;
		case "exploded":
			w.u8(ENTITY_KINDS.indexOf(e.kind));
			w.i16(px(e.x));
			w.i16(px(e.y));
			w.u16(clampInt(e.size, 0, 65535));
			w.u8(COLORS.indexOf(e.color));
			w.u8(clampInt(e.count, 0, 255));
			break;
		case "scored":
			w.u8(at(e.player));
			w.u16(clampInt(e.delta, 0, 65535));
			w.i16(px(e.x));
			w.i16(px(e.y));
			break;
		case "pickup":
			w.u8(at(e.player));
			w.u8(PICKUP_TYPES.indexOf(e.pickup));
			break;
	}
}

// msg: { tick, ack, players, ships, obstacles, pickups, bullets, events }; повертає Uint8Array
export function encodeSnapshot(msg) {
	const players = (msg.players ?? []).slice(0, 255);
	const ids = players.map((p) => encoder.encode(String(p.id)).subarray(0, 255));
	const index = new Map(players.map((p, i) => [p.id, i]));
	const at = (id) => index.get(id) ?? NONE;
	const ships = (msg.ships ?? []).slice(0, 255);
	const obstacles = (msg.obstacles ?? []).slice(0, 255);
	const pickups = (msg.pickups ?? [])
		.filter((p) => PICKUP_TYPES.includes(p.type))
		.slice(0, 255);
	const bullets = (msg.bullets ?? []).slice(0, 65535);
	const events = (msg.events ?? []).filter(encodable).slice(0, 255);

	const size =
		HEADER +
		ids.reduce((n, id) => n + id.length + PLAYER_FIXED, 0) +
		ships.length * SHIP +
		obstacles.length * OBSTACLE +
		pickups.length * PICKUP +
		bullets.length * BULLET +
		events.length * EVENT_MAX;
	const w = new Writer(size);

	w.u8(FORMAT_VERSION);
	w.u8(FRAME.SNAPSHOT);
	w.u32(clampInt(msg.tick, 0, MAX_U32));
	w.u32(clampInt(msg.ack, 0, MAX_U32));
	w.u8(players.length);
	w.u8(ships.length);
	w.u8(obstacles.length);
	w.u8(pickups.length);
	w.u16(bullets.length);
	w.u8(events.length);

	players.forEach((p, i) => {
		w.u8(ids[i].length);
		w.raw(ids[i]);
		w.u32(clampInt(p.score, 0, MAX_U32));
		w.u16(clampInt(p.destroyed, 0, 65535));
		w.u16(clampInt(p.crashes, 0, 65535));
		w.u16(clampInt(p.deaths, 0, 65535));
	});
	for (const s of ships) {
		w.u32(clampInt(s.id, 0, MAX_U32));
		w.u8(at(s.player));
		w.f32(fin(s.x));
		w.f32(fin(s.y));
		w.f32(fin(s.vx));
		w.f32(fin(s.vy));
		w.i16(clampInt(s.pitch, -32768, 32767, 10000));
		w.u16(clampInt(s.cooldown, 0, 65535, 1000));
		w.u16(clampInt(s.shield, 0, 65535, 100));
		w.u16(clampInt(s.rapid, 0, 65535, 100));
		w.u16(clampInt(s.homing, 0, 65535, 100));
		w.u8(clampInt(s.hp, 0, 255));
		w.u8(s.facing > 0 ? 1 : 0);
	}
	for (const o of obstacles) {
		w.u32(clampInt(o.id, 0, MAX_U32));
		w.f32(fin(o.x));
		w.f32(fin(o.y));
		w.f32(fin(o.vx));
		w.f32(fin(o.vy));
		w.u16(clampInt(o.r, 0, 65535));
	}
	for (const p of pickups) {
		w.u32(clampInt(p.id, 0, MAX_U32));
		w.u8(PICKUP_TYPES.indexOf(p.type));
		w.f32(fin(p.x));
		w.f32(fin(p.y));
		w.u8(clampInt(p.life, 0, 255, 100));
	}
	for (const b of bullets) {
		w.u32(clampInt(b.id, 0, MAX_U32));
		w.u8(at(b.owner));
		w.u32(clampInt(b.seq, 0, MAX_U32));
		w.f32(fin(b.x));
		w.f32(fin(b.y));
		w.f32(fin(b.vx));
		w.f32(fin(b.vy));
		w.u16(clampInt(b.ttl, 0, 65535, 1000));
	}
	for (const e of events) writeEvent(w, e, at);
	return w.done();
}

// ---------- snapshot: декодування ----------
function readEvent(r, who) {
	const code = r.u8();
	switch (code) {
		case 1:
			return { type: "fired", player: who(r.u8()), x: r.i16(), y: r.i16() };
		case 2:
			return {
				type: "hit",
				kind: pick(ENTITY_KINDS, r.u8()),
				x: r.i16(),
				y: r.i16(),
			};
		case 3:
			return {
				type: "exploded",
				kind: pick(ENTITY_KINDS, r.u8()),
				x: r.i16(),
				y: r.i16(),
				size: r.u16(),
				color: pick(COLORS, r.u8()),
				count: r.u8(),
			};
		case 4:
			return {
				type: "scored",
				player: who(r.u8()),
				delta: r.u16(),
				x: r.i16(),
				y: r.i16(),
			};
		case 5:
			return {
				type: "pickup",
				player: who(r.u8()),
				pickup: pick(PICKUP_TYPES, r.u8()),
			};
		case 6:
			return { type: "crash", player: who(r.u8()), x: r.i16(), y: r.i16() };
		case 7:
			return { type: "respawned", player: who(r.u8()), x: r.i16(), y: r.i16() };
		default:
			throw new CodecError("невідома подія");
	}
}

export function decodeSnapshot(input) {
	const r = new Reader(input);
	if (r.u8() !== FORMAT_VERSION) throw new CodecError("непідтримувана версія");
	if (r.u8() !== FRAME.SNAPSHOT) throw new CodecError("це не знімок");
	const tick = r.u32();
	const ack = r.u32();
	const nPlayers = r.u8();
	const nShips = r.u8();
	const nObstacles = r.u8();
	const nPickups = r.u8();
	const nBullets = r.u16();
	const nEvents = r.u8();

	const players = list(nPlayers, () => {
		const id = r.text(r.u8());
		return {
			id,
			score: r.u32(),
			destroyed: r.u16(),
			crashes: r.u16(),
			deaths: r.u16(),
		};
	});
	const who = (i) => {
		if (i === NONE) return null;
		if (i >= players.length) throw new CodecError("невідомий гравець");
		return players[i].id;
	};

	const ships = list(nShips, () => {
		const id = r.u32();
		const player = who(r.u8());
		const x = r2(r.f32());
		const y = r2(r.f32());
		const vx = r2(r.f32());
		const vy = r2(r.f32());
		const pitch = r.i16() / 10000;
		const cooldown = r.u16() / 1000;
		const shield = r.u16() / 100;
		const rapid = r.u16() / 100;
		const homing = r.u16() / 100;
		const hp = r.u8();
		const flags = r.u8();
		if (flags & ~1) throw new CodecError("ship: зарезервовані біти");
		return {
			id,
			player,
			x,
			y,
			vx,
			vy,
			pitch,
			facing: flags & 1 ? 1 : -1,
			hp,
			cooldown,
			shield,
			rapid,
			homing,
		};
	});
	const obstacles = list(nObstacles, () => {
		const id = r.u32();
		const x = r2(r.f32());
		const y = r2(r.f32());
		const vx = r2(r.f32());
		const vy = r2(r.f32());
		return { id, x, y, vx, vy, r: r.u16() };
	});
	const pickups = list(nPickups, () => {
		const id = r.u32();
		const type = pick(PICKUP_TYPES, r.u8());
		const x = r2(r.f32());
		const y = r2(r.f32());
		return { id, type, x, y, life: r.u8() / 100 };
	});
	const bullets = list(nBullets, () => {
		const id = r.u32();
		const owner = who(r.u8());
		const seq = r.u32();
		const x = r2(r.f32());
		const y = r2(r.f32());
		const vx = r2(r.f32());
		const vy = r2(r.f32());
		return { id, owner, seq, x, y, vx, vy, ttl: r.u16() / 1000 };
	});
	const events = list(nEvents, () => readEvent(r, who));

	if (r.o !== r.length) throw new CodecError("зайві байти в кінці кадру");
	return make("snapshot", {
		tick,
		ack,
		players,
		ships,
		obstacles,
		bullets,
		pickups,
		events,
	});
}

export const binary = Object.freeze({
	name: "binary",
	isBinary: true,
	encodeSnapshot,
	decodeSnapshot,
	encodeInput,
	decodeInput,
});
