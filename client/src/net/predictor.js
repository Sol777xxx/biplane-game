import { ARENA, wrapDelta } from "biplane-shared/sim/arena.js";
import { Biplane } from "biplane-shared/sim/biplane.js";
import { TICK_DT } from "biplane-shared/sim/time.js";

const MAX_PENDING = 90; // 3 с input без ack

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
export function createPredictor() {
	let enabled = true;
	let plane = null;
	let planeId = null;
	let pending = []; // надіслані input без ack: { seq, keys }

	const clear = () => {
		plane = null;
		planeId = null;
		pending = [];
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
		get ship() {
			return enabled ? plane : null;
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

		// Повертає { reset, correction }: correction це px зсуву від звірки (null: немає що міряти).
		reconcile(msg, youId) {
			if (!enabled) return { reset: false, correction: null };
			const ack = msg.ack ?? 0;
			pending = pending.filter((p) => p.seq > ack);

			const s = msg.ships?.find((x) => x.player === youId);
			if (!s) {
				plane = null; // загиблий: до відродження
				planeId = null;
				return { reset: false, correction: null };
			}

			const fresh = !plane || planeId !== s.id;
			const before = fresh ? null : { x: plane.pos.x, y: plane.pos.y };
			if (fresh) {
				plane = new Biplane();
				planeId = s.id;
			}
			load(plane, s);
			for (const p of pending) plane.update(TICK_DT, p.keys);

			const correction = before
				? Math.hypot(
						wrapDelta(before.x, plane.pos.x, ARENA.width),
						wrapDelta(before.y, plane.pos.y, ARENA.height),
					)
				: 0;
			return { reset: fresh, correction };
		},
	};
}
