import {
	INPUT_KEYS,
	type InputKey,
	MAX_SEQ,
	make,
	type SnapshotMessage,
	type WireEvent,
} from "../protocol/index.ts";
import { type Seq, toEntityId, toSeq, toTick } from "../sim/ids.ts";
import { assertNever } from "../sim/never.ts";
import type { PickupType } from "../sim/objects.ts";
import type { ExplosionColor } from "../sim/types.ts";
import {
	type BinaryCodec,
	CodecError,
	type Frame,
	type KeysLike,
} from "./codec.ts";

export { CodecError };

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
// «Немає» допустиме лише там, де протокол дозволяє null: власник кулі, гравець у fired,
// crash і pickup. У ship, scored і respawned гравець обов'язковий.
// Дробові значення декодер округлює до 0.01, як JSON-знімок: обидва кодеки дають однакові
// об'єкти. Id сутностей u32: лічильник росте всю гру, u16 переповнився б.
// Кодувальник не кидає винятків на даних гри (обрізає, обмежує, пропускає невідоме);
// декодер суворий і кидає CodecError на будь-якому відхиленні від розкладки: чужа версія,
// не та довжина, лічильники більші за кадр, значення поза таблицею, нескінченні числа,
// зарезервовані біти, зайві байти. Те, що він повертає, відповідає схемі протоколу.

export const FORMAT_VERSION = 1;
export const FRAME = Object.freeze({ INPUT: 1, SNAPSHOT: 2 });
export const NONE = 255;

// Порядок у таблицях це порядок у мережі: змінювати його можна лише з новою версією формату.
export type EntityKind = "biplane" | "obstacle";
export const PICKUP_TYPES: readonly PickupType[] = Object.freeze([
	"shield",
	"rapid",
	"homing",
]);
export const ENTITY_KINDS: readonly EntityKind[] = Object.freeze([
	"biplane",
	"obstacle",
]);
export const COLORS: readonly ExplosionColor[] = Object.freeze([
	"pink",
	"storm",
]);

const HEADER = 17;
const INPUT_SIZE = 7;
const MAX_U32 = 0xffffffff;
const F32_MAX = 3.4028234663852886e38;
const SHIP = 33;
const OBSTACLE = 22;
const PICKUP = 14;
const BULLET = 27;
const PLAYER_FIXED = 11; // довжина id (1) + score (4) + три u16
const EVENT_MIN = 2; // код + найкоротша подія (pickup: гравець і тип)
const EVENT_MAX = 10;

// біт кожної клавіші; Record вимагає запис для КОЖНОЇ клавіші
const KEY_BIT: Readonly<Record<InputKey, number>> = {
	up: 1,
	down: 2,
	left: 4,
	right: 8,
	fire: 16,
};
const INPUT_MASK = INPUT_KEYS.reduce((mask, key) => mask | KEY_BIT[key], 0);

const EVENT_CODE: Readonly<Record<WireEvent["type"], number>> = {
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

function toBytes(input: unknown): Uint8Array {
	if (input instanceof Uint8Array) return input; // зокрема Buffer
	if (ArrayBuffer.isView(input)) {
		return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
	}
	if (input instanceof ArrayBuffer) return new Uint8Array(input);
	throw new CodecError("очікується ArrayBuffer або Uint8Array");
}

const fin = (v: number): number => (Number.isFinite(v) ? v : 0);
const clampInt = (v: number, lo: number, hi: number, scale = 1): number =>
	Math.min(hi, Math.max(lo, Math.round(fin(v) * scale)));
const px = (v: number): number => clampInt(v, -32768, 32767);
// f32 поза діапазоном став би Infinity, а декодер таке відхиляє
const f32 = (v: number): number =>
	Math.min(F32_MAX, Math.max(-F32_MAX, fin(v)));
const r2 = (v: number): number => Math.round(v * 100) / 100 + 0; // +0 прибирає «-0», як після JSON

// індекс у таблиці (-1, якщо значення в ній немає)
const indexIn = (table: readonly string[], value: string): number =>
	table.indexOf(value);

class Writer {
	readonly bytes: Uint8Array<ArrayBuffer>;
	readonly view: DataView;
	#o = 0;

	constructor(size: number) {
		this.bytes = new Uint8Array(size);
		this.view = new DataView(this.bytes.buffer);
	}

	u8(v: number): void {
		this.view.setUint8(this.#o, v);
		this.#o += 1;
	}

	i16(v: number): void {
		this.view.setInt16(this.#o, v, true);
		this.#o += 2;
	}

	u16(v: number): void {
		this.view.setUint16(this.#o, v, true);
		this.#o += 2;
	}

	u32(v: number): void {
		this.view.setUint32(this.#o, v, true);
		this.#o += 4;
	}

	f32(v: number): void {
		this.view.setFloat32(this.#o, f32(v), true);
		this.#o += 4;
	}

	raw(bytes: Uint8Array): void {
		this.bytes.set(bytes, this.#o);
		this.#o += bytes.length;
	}

	done(): Uint8Array<ArrayBuffer> {
		return this.bytes.subarray(0, this.#o);
	}
}

class Reader {
	readonly #bytes: Uint8Array;
	readonly #view: DataView;
	#o = 0;

	constructor(input: unknown) {
		this.#bytes = toBytes(input);
		this.#view = new DataView(
			this.#bytes.buffer,
			this.#bytes.byteOffset,
			this.#bytes.byteLength,
		);
	}

	get length(): number {
		return this.#bytes.length;
	}

	get remaining(): number {
		return this.#bytes.length - this.#o;
	}

	// резервує n байтів і повертає зсув їхнього початку
	#take(n: number): number {
		if (this.#o + n > this.#bytes.length) throw new CodecError("кадр обірвано");
		const at = this.#o;
		this.#o += n;
		return at;
	}

	u8(): number {
		return this.#view.getUint8(this.#take(1));
	}

	i16(): number {
		return this.#view.getInt16(this.#take(2), true);
	}

	u16(): number {
		return this.#view.getUint16(this.#take(2), true);
	}

	u32(): number {
		return this.#view.getUint32(this.#take(4), true);
	}

	// NaN і Infinity в стані гри означали б зламаний кадр
	f32(): number {
		const v = this.#view.getFloat32(this.#take(4), true);
		if (!Number.isFinite(v)) throw new CodecError("не скінченне число");
		return v;
	}

	text(n: number): string {
		const at = this.#take(n);
		try {
			return utf8.decode(this.#bytes.subarray(at, at + n));
		} catch {
			throw new CodecError("некоректний UTF-8");
		}
	}

	// після розбору кадр має скінчитись рівно тут
	end(): void {
		if (this.#o !== this.#bytes.length) {
			throw new CodecError("зайві байти в кінці кадру");
		}
	}
}

function pick<T>(table: readonly T[], i: number): T {
	const value = table[i];
	if (value === undefined) throw new CodecError("невідоме значення");
	return value;
}

const list = <T>(n: number, read: () => T): T[] =>
	Array.from({ length: n }, read);

// ---------- input ----------
export function encodeInput(seq: Seq, keys: KeysLike): Uint8Array<ArrayBuffer> {
	const w = new Writer(INPUT_SIZE);
	w.u8(FORMAT_VERSION);
	w.u8(FRAME.INPUT);
	w.u32(clampInt(seq, 0, MAX_SEQ));
	let mask = 0;
	for (const key of INPUT_KEYS) {
		if (keys?.[key]) mask |= KEY_BIT[key];
	}
	w.u8(mask);
	return w.done();
}

// повертає те саме повідомлення, що й parseClientMessage() для JSON-input
export function decodeInput(input: Frame) {
	const r = new Reader(input);
	if (r.length !== INPUT_SIZE)
		throw new CodecError("input: неправильна довжина");
	if (r.u8() !== FORMAT_VERSION) throw new CodecError("непідтримувана версія");
	if (r.u8() !== FRAME.INPUT) throw new CodecError("це не input");
	const seq = toSeq(r.u32());
	const mask = r.u8();
	if (mask & ~INPUT_MASK) throw new CodecError("input: зарезервовані біти");
	return make("input", {
		seq,
		up: (mask & KEY_BIT.up) !== 0,
		down: (mask & KEY_BIT.down) !== 0,
		left: (mask & KEY_BIT.left) !== 0,
		right: (mask & KEY_BIT.right) !== 0,
		fire: (mask & KEY_BIT.fire) !== 0,
	});
}

// { version, type } з перших двох байтів, або null, якщо кадр коротший
export function frameType(
	input: Frame,
): { readonly version: number; readonly type: number } | null {
	const [version, type] = toBytes(input);
	return version !== undefined && type !== undefined ? { version, type } : null;
}

// ---------- snapshot: кодування ----------
type PlayerIndex = ReadonlyMap<string, number>;

// Чи можна цю подію записати. Кодувальник не кидає винятків: невідоме пропускає.
// Перевірка типу в рантаймі лишається, бо подія може прийти не з нашого коду.
function encodable(e: WireEvent, known: PlayerIndex): boolean {
	if (!e || !Object.hasOwn(EVENT_CODE, e.type)) return false;
	switch (e.type) {
		case "fired":
		case "crash":
			return true;
		case "hit":
			return indexIn(ENTITY_KINDS, e.kind) >= 0;
		case "exploded":
			return indexIn(ENTITY_KINDS, e.kind) >= 0 && COLORS.includes(e.color);
		case "pickup":
			return PICKUP_TYPES.includes(e.pickup);
		// гравець тут обов'язковий: подію невідомого гравця краще пропустити,
		// ніж віддати клієнту «null» там, де протокол обіцяє рядок
		case "scored":
		case "respawned":
			return known.has(e.player);
		default:
			return assertNever(e, "подія");
	}
}

function writeEvent(
	w: Writer,
	e: WireEvent,
	at: (id: string | null) => number,
): void {
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
			w.u8(indexIn(ENTITY_KINDS, e.kind));
			w.i16(px(e.x));
			w.i16(px(e.y));
			break;
		case "exploded":
			w.u8(indexIn(ENTITY_KINDS, e.kind));
			w.i16(px(e.x));
			w.i16(px(e.y));
			w.u16(clampInt(e.size, 0, 65535));
			w.u8(indexIn(COLORS, e.color));
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
			w.u8(indexIn(PICKUP_TYPES, e.pickup));
			break;
		default:
			assertNever(e, "подія");
	}
}

const ACK_OFFSET = 6; // версія (1) + код кадру (1) + tick (4)

// Копія кадру знімка з іншим ack: байти ті самі, що дав би encodeSnapshot з цим ack.
export function withAck(
	frame: Uint8Array<ArrayBuffer>,
	ack: number,
): Uint8Array<ArrayBuffer> {
	const copy = frame.slice(); // власний буфер, оригінал спільний і не змінюється
	new DataView(copy.buffer).setUint32(
		ACK_OFFSET,
		clampInt(ack, 0, MAX_U32),
		true,
	);
	return copy;
}

// повертає Uint8Array; усе, що не вміщується у формат, обрізає або пропускає
export function encodeSnapshot(msg: SnapshotMessage): Uint8Array<ArrayBuffer> {
	const players = msg.players.slice(0, 255);
	const ids = players.map((p) => encoder.encode(p.id).subarray(0, 255));
	const index: PlayerIndex = new Map(players.map((p, i) => [p.id, i]));
	const at = (id: string | null): number =>
		id === null ? NONE : (index.get(id) ?? NONE);
	// корабель невідомого гравця пропускаємо: у знімку player це рядок, не null
	const ships = msg.ships.filter((s) => index.has(s.player)).slice(0, 255);
	const obstacles = msg.obstacles.slice(0, 255);
	const pickups = msg.pickups
		.filter((p) => PICKUP_TYPES.includes(p.type))
		.slice(0, 255);
	const bullets = msg.bullets.slice(0, 65535);
	const events = msg.events.filter((e) => encodable(e, index)).slice(0, 255);

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
		const id = ids[i];
		if (id === undefined) return; // ids і players однакової довжини
		w.u8(id.length);
		w.raw(id);
		w.u32(clampInt(p.score, 0, MAX_U32));
		w.u16(clampInt(p.destroyed, 0, 65535));
		w.u16(clampInt(p.crashes, 0, 65535));
		w.u16(clampInt(p.deaths, 0, 65535));
	});
	for (const s of ships) {
		w.u32(clampInt(s.id, 0, MAX_U32));
		w.u8(at(s.player));
		w.f32(s.x);
		w.f32(s.y);
		w.f32(s.vx);
		w.f32(s.vy);
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
		w.f32(o.x);
		w.f32(o.y);
		w.f32(o.vx);
		w.f32(o.vy);
		w.u16(clampInt(o.r, 0, 65535));
	}
	for (const p of pickups) {
		w.u32(clampInt(p.id, 0, MAX_U32));
		w.u8(indexIn(PICKUP_TYPES, p.type));
		w.f32(p.x);
		w.f32(p.y);
		w.u8(clampInt(p.life, 0, 255, 100));
	}
	for (const b of bullets) {
		w.u32(clampInt(b.id, 0, MAX_U32));
		w.u8(at(b.owner));
		w.u32(clampInt(b.seq, 0, MAX_U32));
		w.f32(b.x);
		w.f32(b.y);
		w.f32(b.vx);
		w.f32(b.vy);
		w.u16(clampInt(b.ttl, 0, 65535, 1000));
	}
	for (const e of events) writeEvent(w, e, at);
	return w.done();
}

// ---------- snapshot: декодування ----------
type Who = {
	// null (255) дозволений лише там, де протокол допускає «ніхто»
	readonly maybe: (i: number) => string | null;
	readonly must: (i: number) => string;
};

function readEvent(r: Reader, who: Who): WireEvent {
	const code = r.u8();
	switch (code) {
		case 1:
			return {
				type: "fired",
				player: who.maybe(r.u8()),
				x: r.i16(),
				y: r.i16(),
			};
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
				player: who.must(r.u8()),
				delta: r.u16(),
				x: r.i16(),
				y: r.i16(),
			};
		case 5:
			return {
				type: "pickup",
				player: who.maybe(r.u8()),
				pickup: pick(PICKUP_TYPES, r.u8()),
			};
		case 6:
			return {
				type: "crash",
				player: who.maybe(r.u8()),
				x: r.i16(),
				y: r.i16(),
			};
		case 7:
			return {
				type: "respawned",
				player: who.must(r.u8()),
				x: r.i16(),
				y: r.i16(),
			};
		default:
			throw new CodecError("невідома подія");
	}
}

export function decodeSnapshot(input: Frame): SnapshotMessage {
	const r = new Reader(input);
	if (r.u8() !== FORMAT_VERSION) throw new CodecError("непідтримувана версія");
	if (r.u8() !== FRAME.SNAPSHOT) throw new CodecError("це не знімок");
	const tick = toTick(r.u32());
	const ack = toSeq(r.u32());
	const nPlayers = r.u8();
	const nShips = r.u8();
	const nObstacles = r.u8();
	const nPickups = r.u8();
	const nBullets = r.u16();
	const nEvents = r.u8();

	// Лічильники з кадру ще нічому не вірять: якщо навіть найменші записи не вміщуються
	// в решту байтів, кадр зламаний, і порожні масиви під ці лічильники не створюємо.
	const smallest =
		nPlayers * PLAYER_FIXED +
		nShips * SHIP +
		nObstacles * OBSTACLE +
		nPickups * PICKUP +
		nBullets * BULLET +
		nEvents * EVENT_MIN;
	if (smallest > r.remaining) throw new CodecError("кадр обірвано");

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
	// гравців не більше 255, тож індекс 255 (NONE) ніколи не є справжнім гравцем
	const who: Who = {
		must: (i) => {
			const p = players[i];
			if (p === undefined) throw new CodecError("невідомий гравець");
			return p.id;
		},
		maybe: (i) => (i === NONE ? null : who.must(i)),
	};

	const ships = list(nShips, () => {
		const id = toEntityId(r.u32());
		const player = who.must(r.u8());
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
		const id = toEntityId(r.u32());
		const x = r2(r.f32());
		const y = r2(r.f32());
		const vx = r2(r.f32());
		const vy = r2(r.f32());
		return { id, x, y, vx, vy, r: r.u16() };
	});
	const pickups = list(nPickups, () => {
		const id = toEntityId(r.u32());
		const type = pick(PICKUP_TYPES, r.u8());
		const x = r2(r.f32());
		const y = r2(r.f32());
		return { id, type, x, y, life: r.u8() / 100 };
	});
	const bullets = list(nBullets, () => {
		const id = toEntityId(r.u32());
		const owner = who.maybe(r.u8());
		const seq = toSeq(r.u32());
		const x = r2(r.f32());
		const y = r2(r.f32());
		const vx = r2(r.f32());
		const vy = r2(r.f32());
		return { id, owner, seq, x, y, vx, vy, ttl: r.u16() / 1000 };
	});
	const events = list(nEvents, () => readEvent(r, who));

	r.end();
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

export const binary: BinaryCodec = Object.freeze<BinaryCodec>({
	name: "binary",
	isBinary: true,
	withAck,
	encodeSnapshot,
	decodeSnapshot,
	encodeInput,
	decodeInput,
});
