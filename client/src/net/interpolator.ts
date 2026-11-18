import type {
	BulletSnapshot,
	ObstacleSnapshot,
	PickupSnapshot,
	ShipSnapshot,
	WireEvent,
} from "biplane-shared/protocol/index.ts";
import { ARENA, wrap, wrapDelta } from "biplane-shared/sim/arena.ts";
import type { EntityId } from "biplane-shared/sim/ids.ts";
import { TICK_RATE } from "biplane-shared/sim/time.ts";
import type { Vec2 } from "biplane-shared/sim/vector.ts";

export const TICK_MS = 1000 / TICK_RATE;
export const MAX_DELAY = 500;
const MAX_BUF = 64; // знімків і наборів подій
const STARVE_FRAMES = 120; // вікно для частки «голодних» кадрів

// Що інтерполятор бере зі знімка. Списки можуть бути відсутні (тоді вважаємо їх порожніми).
export interface InterpFrame {
	readonly tick: number;
	readonly ships?: readonly ShipSnapshot[];
	readonly obstacles?: readonly ObstacleSnapshot[];
	readonly bullets?: readonly BulletSnapshot[];
	readonly pickups?: readonly PickupSnapshot[];
	readonly events?: readonly WireEvent[];
}

// Те, що віддає sample(): стан на момент часу t (t: null, поки знімків немає).
export interface Sample {
	readonly t: number | null;
	readonly starved: boolean;
	readonly ships: readonly ShipSnapshot[];
	readonly obstacles: readonly ObstacleSnapshot[];
	readonly bullets: readonly BulletSnapshot[];
	readonly pickups: readonly PickupSnapshot[];
}

type Rows = Omit<Sample, "t" | "starved">;
type Maps = {
	readonly [K in keyof Rows]: ReadonlyMap<EntityId, Rows[K][number]>;
};
interface Entry {
	readonly tick: number;
	readonly ms: number;
	readonly rows: Rows;
	readonly maps: Maps;
}

export interface InterpolatorOptions {
	readonly delay?: number;
	readonly now?: () => number;
	readonly span?: number;
	readonly slew?: number;
}

const clamp = (v: number, lo: number, hi: number): number =>
	Math.min(hi, Math.max(lo, v));
const clampDelay = (ms: number): number => clamp(Number(ms) || 0, 0, MAX_DELAY);

const list = <T>(rows: readonly T[] | undefined): readonly T[] =>
	Array.isArray(rows) ? rows : [];
const byId = <R extends { readonly id: EntityId }>(
	rows: readonly R[],
): ReadonlyMap<EntityId, R> =>
	new Map<EntityId, R>(rows.map((r): [EntityId, R] => [r.id, r]));

function index(frame: InterpFrame): { rows: Rows; maps: Maps } {
	const rows: Rows = {
		ships: list(frame.ships),
		obstacles: list(frame.obstacles),
		bullets: list(frame.bullets),
		pickups: list(frame.pickups),
	};
	return {
		rows,
		maps: {
			ships: byId(rows.ships),
			obstacles: byId(rows.obstacles),
			bullets: byId(rows.bullets),
			pickups: byId(rows.pickups),
		},
	};
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

// x і y з урахуванням загортання арени
const lerpXY = (a: Vec2, b: Vec2, k: number): Vec2 => ({
	x: wrap(a.x + wrapDelta(a.x, b.x, ARENA.width) * k, ARENA.width),
	y: wrap(a.y + wrapDelta(a.y, b.y, ARENA.height) * k, ARENA.height),
});

// Що інтерполюється в кожному виді; решта полів береться з ближчого знімка (k < 0.5: з a).
// Тип рядка тут повний (не просто Vec2), тож пропущене поле це помилка tsc.
const blendShip = (
	a: ShipSnapshot,
	b: ShipSnapshot,
	k: number,
): ShipSnapshot => ({
	...(k < 0.5 ? a : b),
	...lerpXY(a, b, k),
	vx: lerp(a.vx, b.vx, k),
	vy: lerp(a.vy, b.vy, k),
	pitch: lerp(a.pitch, b.pitch, k),
	shield: lerp(a.shield, b.shield, k),
	rapid: lerp(a.rapid, b.rapid, k),
	homing: lerp(a.homing, b.homing, k),
});
const blendObstacle = (
	a: ObstacleSnapshot,
	b: ObstacleSnapshot,
	k: number,
): ObstacleSnapshot => ({
	...(k < 0.5 ? a : b),
	...lerpXY(a, b, k),
	vx: lerp(a.vx, b.vx, k),
	vy: lerp(a.vy, b.vy, k),
});
const blendBullet = (
	a: BulletSnapshot,
	b: BulletSnapshot,
	k: number,
): BulletSnapshot => ({
	...(k < 0.5 ? a : b),
	...lerpXY(a, b, k),
	vx: lerp(a.vx, b.vx, k),
	vy: lerp(a.vy, b.vy, k),
	ttl: lerp(a.ttl, b.ttl, k),
});
const blendPickup = (
	a: PickupSnapshot,
	b: PickupSnapshot,
	k: number,
): PickupSnapshot => ({
	...(k < 0.5 ? a : b),
	...lerpXY(a, b, k),
	life: lerp(a.life, b.life, k),
});

// сутність зникла в наступному знімку: стоїть на місці
const step = <R>(
	row: R,
	next: R | undefined,
	k: number,
	blend: (a: R, b: R, k: number) => R,
): R => (next ? blend(row, next, k) : row);

// Буфер знімків і вибірка «в минулому». Час сервера це tick·TICK_MS; зсув до годинника
// клієнта це мінімум за вікно (найшвидші пакети), що рухається не швидше slew мс на знімок.
export function createInterpolator({
	delay = 100,
	now: clock = () => performance.now(),
	span = 90,
	slew = 1,
}: InterpolatorOptions = {}) {
	let ms = clampDelay(delay);
	const buf: Entry[] = [];
	const offsets: number[] = [];
	const queue: { ms: number; events: readonly WireEvent[] }[] = [];
	let offset = 0;
	let lastTick: number | null = null;
	const flags = new Uint8Array(STARVE_FRAMES);
	let fi = 0;
	let flagSum = 0;
	let frames = 0;

	const mark = (starved: boolean): void => {
		const v = starved ? 1 : 0;
		flagSum += v - (flags[fi] ?? 0);
		flags[fi] = v;
		fi = (fi + 1) % STARVE_FRAMES;
		frames++;
	};

	function reset(): void {
		buf.length = 0;
		offsets.length = 0;
		queue.length = 0;
		lastTick = null;
		offset = 0;
	}

	const empty = (t: number | null, starved: boolean): Sample => ({
		t,
		starved,
		ships: [],
		obstacles: [],
		bullets: [],
		pickups: [],
	});

	return {
		get delay(): number {
			return ms;
		},
		set delay(value: number) {
			ms = clampDelay(value);
		},
		reset,

		push(frame: InterpFrame, at: number = clock()): void {
			if (!Number.isInteger(frame?.tick)) return;
			if (lastTick !== null) {
				if (frame.tick < lastTick)
					reset(); // новий матч: лічильник тіків почався знову
				else if (frame.tick === lastTick) return;
			}
			lastTick = frame.tick;
			const serverMs = frame.tick * TICK_MS;

			offsets.push(at - serverMs);
			if (offsets.length > span) offsets.shift();
			const target = Math.min(...offsets);
			const first = offsets[0];
			offset =
				offsets.length === 1 && first !== undefined
					? first
					: offset + clamp(target - offset, -slew, slew);

			buf.push({ tick: frame.tick, ms: serverMs, ...index(frame) });
			if (buf.length > MAX_BUF) buf.shift();
			if (frame.events?.length) {
				queue.push({ ms: serverMs, events: frame.events });
				if (queue.length > MAX_BUF) queue.shift();
			}
		},

		// Стан у момент now − зсув − delay. Немає новішого знімка: стоїмо на останньому (starved).
		sample(now: number = clock()): Sample {
			const last = buf[buf.length - 1];
			if (!last) {
				mark(false);
				return empty(null, false);
			}
			const t = now - offset - ms;
			const hi = buf.findIndex((e) => e.ms > t);
			const b = buf[hi]; // hi = -1 (немає новішого) дає undefined
			if (!b) {
				mark(true);
				buf.splice(0, buf.length - 1);
				return { t, starved: true, ...last.rows };
			}
			mark(false);
			const a = buf[hi - 1]; // hi = 0 (час раніше за всі знімки) дає undefined
			if (!a) return { t, starved: false, ...b.rows };

			buf.splice(0, hi - 1);
			const k = (t - a.ms) / (b.ms - a.ms);
			return {
				t,
				starved: false,
				ships: a.rows.ships.map((r) =>
					step(r, b.maps.ships.get(r.id), k, blendShip),
				),
				obstacles: a.rows.obstacles.map((r) =>
					step(r, b.maps.obstacles.get(r.id), k, blendObstacle),
				),
				bullets: a.rows.bullets.map((r) =>
					step(r, b.maps.bullets.get(r.id), k, blendBullet),
				),
				pickups: a.rows.pickups.map((r) =>
					step(r, b.maps.pickups.get(r.id), k, blendPickup),
				),
			};
		},

		// події знімків, до яких дійшов час відтворення (кожна видається один раз)
		drain(t: number | null | undefined): WireEvent[] {
			const out: WireEvent[] = [];
			if (t === null || t === undefined) return out;
			for (let head = queue[0]; head && head.ms <= t; head = queue[0]) {
				queue.shift();
				out.push(...head.events);
			}
			return out;
		},

		stats() {
			return {
				delay: ms,
				buffered: buf.length,
				starvedPct: (flagSum / Math.min(frames, STARVE_FRAMES || 1) || 0) * 100,
				offset,
			};
		},
	};
}

export type Interpolator = ReturnType<typeof createInterpolator>;
