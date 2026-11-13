import { ARENA, wrap, wrapDelta } from "biplane-shared/sim/arena.js";
import { TICK_RATE } from "biplane-shared/sim/time.js";

export const TICK_MS = 1000 / TICK_RATE;
export const MAX_DELAY = 500;
const MAX_BUF = 64; // знімків і наборів подій
const STARVE_FRAMES = 120; // вікно для частки «голодних» кадрів

// поля, що інтерполюються; решта береться з ближчого знімка
const FIELDS = {
	ships: ["x", "y", "vx", "vy", "pitch", "shield", "rapid", "homing"],
	obstacles: ["x", "y", "vx", "vy"],
	bullets: ["x", "y", "vx", "vy", "ttl"],
	pickups: ["x", "y", "life"],
};
const KINDS = Object.keys(FIELDS);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clampDelay = (ms) => clamp(Number(ms) || 0, 0, MAX_DELAY);

function index(msg) {
	const rows = {};
	const maps = {};
	for (const kind of KINDS) {
		rows[kind] = Array.isArray(msg[kind]) ? msg[kind] : [];
		maps[kind] = new Map(rows[kind].map((r) => [r.id, r]));
	}
	return { rows, maps };
}

// x і y з урахуванням загортання арени
function lerpRow(a, b, k, fields) {
	const out = { ...(k < 0.5 ? a : b) };
	for (const f of fields) {
		if (f === "x") {
			out.x = wrap(a.x + wrapDelta(a.x, b.x, ARENA.width) * k, ARENA.width);
		} else if (f === "y") {
			out.y = wrap(a.y + wrapDelta(a.y, b.y, ARENA.height) * k, ARENA.height);
		} else out[f] = a[f] + (b[f] - a[f]) * k;
	}
	return out;
}

// Буфер знімків і вибірка «в минулому». Час сервера це tick·TICK_MS; зсув до годинника
// клієнта це мінімум за вікно (найшвидші пакети), що рухається не швидше slew мс на знімок.
export function createInterpolator({
	delay = 100,
	now: clock = () => performance.now(),
	span = 90,
	slew = 1,
} = {}) {
	let ms = clampDelay(delay);
	const buf = []; // { tick, ms, rows, maps }
	const offsets = [];
	const queue = []; // { ms, events }
	let offset = 0;
	let lastTick = null;
	const flags = new Uint8Array(STARVE_FRAMES);
	let fi = 0;
	let flagSum = 0;
	let frames = 0;

	const mark = (starved) => {
		const v = starved ? 1 : 0;
		flagSum += v - flags[fi];
		flags[fi] = v;
		fi = (fi + 1) % STARVE_FRAMES;
		frames++;
	};

	function reset() {
		buf.length = 0;
		offsets.length = 0;
		queue.length = 0;
		lastTick = null;
		offset = 0;
	}

	return {
		get delay() {
			return ms;
		},
		set delay(value) {
			ms = clampDelay(value);
		},
		reset,

		push(msg, at = clock()) {
			if (!Number.isInteger(msg?.tick)) return;
			if (lastTick !== null) {
				if (msg.tick < lastTick)
					reset(); // новий матч: лічильник тіків почався знову
				else if (msg.tick === lastTick) return;
			}
			lastTick = msg.tick;
			const serverMs = msg.tick * TICK_MS;

			offsets.push(at - serverMs);
			if (offsets.length > span) offsets.shift();
			const target = Math.min(...offsets);
			offset =
				offsets.length === 1
					? offsets[0]
					: offset + clamp(target - offset, -slew, slew);

			buf.push({ tick: msg.tick, ms: serverMs, ...index(msg) });
			if (buf.length > MAX_BUF) buf.shift();
			if (msg.events?.length) {
				queue.push({ ms: serverMs, events: msg.events });
				if (queue.length > MAX_BUF) queue.shift();
			}
		},

		// Стан у момент now − зсув − delay. Немає новішого знімка: стоїмо на останньому (starved).
		sample(now = clock()) {
			if (buf.length === 0) {
				mark(false);
				return {
					t: null,
					starved: false,
					ships: [],
					obstacles: [],
					bullets: [],
					pickups: [],
				};
			}
			const t = now - offset - ms;
			const hi = buf.findIndex((e) => e.ms > t);
			if (hi === -1) {
				mark(true);
				buf.splice(0, buf.length - 1);
				return { t, starved: true, ...buf[0].rows };
			}
			mark(false);
			if (hi === 0) return { t, starved: false, ...buf[0].rows };

			const a = buf[hi - 1];
			const b = buf[hi];
			buf.splice(0, hi - 1);
			const k = (t - a.ms) / (b.ms - a.ms);
			const out = { t, starved: false };
			for (const kind of KINDS) {
				out[kind] = a.rows[kind].map((row) => {
					const next = b.maps[kind].get(row.id);
					return next ? lerpRow(row, next, k, FIELDS[kind]) : row; // зникла: стоїть на місці
				});
			}
			return out;
		},

		// події знімків, до яких дійшов час відтворення (кожна видається один раз)
		drain(t) {
			const out = [];
			if (t === null || t === undefined) return out;
			while (queue.length && queue[0].ms <= t)
				out.push(...queue.shift().events);
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
