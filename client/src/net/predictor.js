import { ARENA, wrapDelta } from "biplane-shared/sim/arena.ts";
import { Biplane } from "biplane-shared/sim/biplane.ts";
import { Bullet } from "biplane-shared/sim/objects.ts";
import { TICK_DT } from "biplane-shared/sim/time.ts";

const MAX_PENDING = 90; // 3 с input без ack
const MAX_SHOTS = 40;
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

// куля в стан сервера + стільки кроків, на скільки клієнт попереду
function adopt(bullet, b, ahead) {
	bullet.alive = true;
	bullet.pos.set(b.x, b.y);
	bullet.prevPos.set(b.x, b.y);
	bullet.vel.set(b.vx, b.vy);
	bullet.ttl = b.ttl;
	for (let i = 0; i < ahead && bullet.alive; i++) bullet.update(TICK_DT);
}

// Передбачення власного корабля й куль: той самий код, що й на сервері.
// smooth: секунди згладжування (0: вимкнено); onFire({ x, y }): викликається при локальному пострілі.
export function createPredictor({ smooth = SMOOTH_S, onFire = null } = {}) {
	let enabled = true;
	let plane = null;
	let planeId = null;
	let pending = []; // надіслані input без ack: { seq, keys }
	let shots = []; // свої кулі: { seq, id (серверний або null), bullet }
	let offset = { x: 0, y: 0 };
	let prevOffset = { x: 0, y: 0 }; // зсув на попередньому кроці (для інтерполяції кадрів)

	// світ-заглушка: Biplane.fire кладе кулі сюди, а не у світ гри
	const spawned = [];
	const stub = {
		events: [],
		emit() {},
		spawn(e) {
			e.world = null;
			spawned.push(e);
			return e;
		},
	};

	const clearOffset = () => {
		offset = { x: 0, y: 0 };
		prevOffset = { x: 0, y: 0 };
	};
	const clear = () => {
		plane = null;
		planeId = null;
		pending = [];
		shots = [];
		spawned.length = 0;
		clearOffset();
	};

	const advanceShots = () => {
		for (const s of shots) s.bullet.update(TICK_DT);
		shots = shots.filter((s) => s.bullet.alive);
	};

	// Звірка куль зі знімком. Куля з тим самим seq (або id) усиновлюється: стан сервера плюс
	// кроки, на які клієнт попереду. Локальна без пари зникає, коли сервер її вже обробив.
	function syncShots(bullets, youId, ack) {
		const ahead = pending.length;
		const mine = (bullets ?? []).filter((b) => b.owner === youId);
		const used = new Set();
		const next = [];
		for (const shot of shots) {
			const b =
				shot.id !== null
					? mine.find((x) => x.id === shot.id)
					: shot.seq > 0
						? mine.find((x) => x.seq === shot.seq && !used.has(x.id))
						: undefined;
			if (b) {
				used.add(b.id);
				shot.id = b.id;
				adopt(shot.bullet, b, ahead);
				if (shot.bullet.alive) next.push(shot);
			} else if (shot.id === null && shot.seq > ack) {
				next.push(shot); // сервер ще не дійшов до цього input
			}
		}
		for (const b of mine) {
			if (used.has(b.id)) continue; // своя куля без пари (постріл із повтору клавіш)
			const bullet = new Bullet({
				owner: null,
				x: b.x,
				y: b.y,
				vx: b.vx,
				vy: b.vy,
				ttl: b.ttl,
			});
			adopt(bullet, b, ahead);
			if (bullet.alive) next.push({ seq: b.seq ?? 0, id: b.id, bullet });
		}
		shots = next;
	}

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
		// свої кулі як сутності Bullet (порожньо, поки передбачення вимкнене)
		get shots() {
			return enabled ? shots.map((s) => s.bullet) : [];
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
			advanceShots(); // нова куля стартує з наступного кроку, як на сервері
			if (!plane) return;
			plane.update(TICK_DT, { ...keys, seq });
			for (const bullet of spawned.splice(0)) {
				shots.push({ seq, id: null, bullet });
				onFire?.({ x: bullet.pos.x, y: bullet.pos.y });
			}
			if (shots.length > MAX_SHOTS) shots.splice(0, shots.length - MAX_SHOTS);
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
			syncShots(msg.bullets, youId, ack);

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
				plane.world = stub;
				planeId = s.id;
				clearOffset(); // відродження: жорстке скидання
			}
			load(plane, s);
			for (const p of pending) {
				plane.update(TICK_DT, { ...p.keys, seq: p.seq });
				spawned.length = 0; // кулі повтору вже є серед shots
			}

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
