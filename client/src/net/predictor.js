import { ARENA, wrapDelta } from "biplane-shared/sim/arena.js";
import { Biplane } from "biplane-shared/sim/biplane.js";
import { TICK_DT } from "biplane-shared/sim/time.js";

const MAX_PENDING = 90; // 3 с input без ack
export const SMOOTH_S = 0.1; // за скільки секунд згасає поправка (~95%)

// стан сервера (рядок знімка) у корабель для повтору
function load(plane, s) {
	plane.pos.set(s.x, s.y);
	plane.prevPos.set(s.x, s.y);
	plane.vel.set(s.vx, s.vy);
	plane.pitch = plane.prevPitch = s.pitch;
	plane.facing = s.facing;
	plane.cooldown = s.cooldown;
	plane.effects.shield = s.shield;
	plane.effects.rapid = s.rapid;
	plane.effects.homing = s.homing;
}

// Передбачення власного корабля: той самий Biplane.update, що й на сервері.
// smooth: секунди згладжування (0: вимкнено). Видима позиція (pose) це передбачена + зсув;
// зсув спадає експоненційно, нові поправки додаються до нього.
export function createPredictor({ smooth = SMOOTH_S } = {}) {
	let enabled = true;
	let plane = null;
	let planeId = null;
	let pending = []; // надіслані input без ack: { seq, keys }
	let offset = { x: 0, y: 0 };
	let prevOffset = { x: 0, y: 0 }; // зсув на попередньому кроці (для інтерполяції кадрів)

	const clearOffset = () => {
		offset = { x: 0, y: 0 };
		prevOffset = { x: 0, y: 0 };
	};
	const clear = () => {
		plane = null;
		planeId = null;
		pending = [];
		clearOffset();
	};

	return {
		get enabled() {
			return enabled;
		},
		// зміна стану скидає все: стан підтягнеться з наступного знімка
		set enabled(on) {
			enabled = Boolean(on);
			clear();
		},
		// сирий передбачений корабель (без зсуву)
		get ship() {
			return enabled ? plane : null;
		},
		// те, що малюємо: позиція зі зсувом, решта як є (null: передбачення немає)
		get pose() {
			if (!enabled || !plane) return null;
			return {
				pos: { x: plane.pos.x + offset.x, y: plane.pos.y + offset.y },
				prevPos: {
					x: plane.prevPos.x + prevOffset.x,
					y: plane.prevPos.y + prevOffset.y,
				},
				vel: plane.vel,
				pitch: plane.pitch,
				prevPitch: plane.prevPitch,
				facing: plane.facing,
			};
		},
		get pending() {
			return pending.length;
		},
		reset: clear,

		// input щойно надіслано: запам'ятати й одразу застосувати
		step(seq, keys) {
			if (!enabled) return;
			pending.push({ seq, keys });
			if (pending.length > MAX_PENDING) pending.shift();
			plane?.update(TICK_DT, keys);
		},

		// згасання зсуву: раз на крок симуляції
		tick(dt) {
			prevOffset = offset;
			if (!(smooth > 0)) return;
			const k = Math.exp((-3 * dt) / smooth);
			const x = offset.x * k;
			const y = offset.y * k;
			offset = Math.hypot(x, y) < 0.01 ? { x: 0, y: 0 } : { x, y };
		},

		// Повертає { reset, correction }: correction це сирий зсув від звірки в px
		// (null: немає що міряти). Згладжування на нього не впливає.
		reconcile(msg, youId) {
			if (!enabled) return { reset: false, correction: null };
			const ack = msg.ack ?? 0;
			pending = pending.filter((p) => p.seq > ack);

			const s = msg.ships?.find((x) => x.player === youId);
			if (!s) {
				plane = null; // загиблий: до відродження
				planeId = null;
				clearOffset();
				return { reset: false, correction: null };
			}

			const fresh = !plane || planeId !== s.id;
			const before = fresh ? null : { x: plane.pos.x, y: plane.pos.y };
			if (fresh) {
				plane = new Biplane();
				planeId = s.id;
				clearOffset(); // відродження: жорстке скидання
			}
			load(plane, s);
			for (const p of pending) plane.update(TICK_DT, p.keys);

			let correction = 0;
			if (before) {
				// зсув «було мінус стало»: корабель на екрані лишається там, де був
				const dx = wrapDelta(plane.pos.x, before.x, ARENA.width);
				const dy = wrapDelta(plane.pos.y, before.y, ARENA.height);
				correction = Math.hypot(dx, dy);
				if (smooth > 0) {
					offset = { x: offset.x + dx, y: offset.y + dy };
					prevOffset = offset;
				}
			}
			return { reset: fresh, correction };
		},
	};
}
