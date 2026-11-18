import type {
	BulletSnapshot,
	ShipSnapshot,
} from "biplane-shared/protocol/index.ts";
import { ARENA, wrapDelta } from "biplane-shared/sim/arena.ts";
import { Biplane } from "biplane-shared/sim/biplane.ts";
import type { Entity, EntityWorld } from "biplane-shared/sim/entity.ts";
import { type EntityId, NO_SEQ, type Seq } from "biplane-shared/sim/ids.ts";
import { Bullet } from "biplane-shared/sim/objects.ts";
import { TICK_DT } from "biplane-shared/sim/time.ts";
import type { InputState } from "biplane-shared/sim/types.ts";
import type { Vec2 } from "biplane-shared/sim/vector.ts";

const MAX_PENDING = 90; // 3 с input без ack
const MAX_SHOTS = 40;
export const SMOOTH_S = 0.1; // за скільки секунд згасає поправка (~95%)

// стан клавіш одного кроку (без seq: його додає predictor)
export type PredictorKeys = Omit<InputState, "seq">;

export interface PredictorOptions {
	// секунди згладжування (0: вимкнено)
	readonly smooth?: number;
	// викликається при локальному пострілі
	readonly onFire?: ((at: Vec2) => void) | null;
}

// Що predictor бере зі знімка (повний знімок сервера теж підходить).
export interface ReconcileInput {
	readonly ack?: number;
	readonly bullets?: readonly BulletSnapshot[];
	readonly ships?: readonly ShipSnapshot[];
}

// Те, що малюємо для власного корабля: позиція зі зсувом, решта як є.
export interface Pose {
	readonly pos: Vec2;
	readonly prevPos: Vec2;
	readonly vel: Vec2;
	readonly pitch: number;
	readonly prevPitch: number;
	readonly facing: number;
}

export interface Reconciled {
	readonly reset: boolean;
	readonly correction: number | null;
}

interface Pending {
	readonly seq: Seq;
	readonly keys: PredictorKeys;
}

// своя куля: seq input-пострілу, серверний id (null, поки сервер її не підтвердив)
interface Shot {
	seq: Seq;
	id: EntityId | null;
	readonly bullet: Bullet;
}

// стан сервера (рядок знімка) у корабель для повтору
function load(plane: Biplane, s: ShipSnapshot): void {
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
function adopt(bullet: Bullet, b: BulletSnapshot, ahead: number): void {
	bullet.alive = true;
	bullet.pos.set(b.x, b.y);
	bullet.prevPos.set(b.x, b.y);
	bullet.vel.set(b.vx, b.vy);
	bullet.ttl = b.ttl;
	for (let i = 0; i < ahead && bullet.alive; i++) bullet.update(TICK_DT);
}

// Передбачення власного корабля й куль: той самий код, що й на сервері.
export function createPredictor({
	smooth = SMOOTH_S,
	onFire = null,
}: PredictorOptions = {}) {
	let enabled = true;
	let plane: Biplane | null = null;
	let planeId: EntityId | null = null;
	let pending: Pending[] = []; // надіслані input без ack
	let shots: Shot[] = []; // свої кулі
	let offset: Vec2 = { x: 0, y: 0 };
	let prevOffset: Vec2 = { x: 0, y: 0 }; // зсув на попередньому кроці (для інтерполяції кадрів)

	// світ-заглушка: Biplane.fire кладе кулі сюди, а не у світ гри
	const spawned: Entity[] = [];
	const stub: EntityWorld = {
		events: [],
		emit() {},
		spawn(e) {
			e.world = null;
			spawned.push(e);
			return e;
		},
		ofKind: () => [],
	};

	const clearOffset = (): void => {
		offset = { x: 0, y: 0 };
		prevOffset = { x: 0, y: 0 };
	};
	const clear = (): void => {
		plane = null;
		planeId = null;
		pending = [];
		shots = [];
		spawned.length = 0;
		clearOffset();
	};

	const advanceShots = (): void => {
		for (const s of shots) s.bullet.update(TICK_DT);
		shots = shots.filter((s) => s.bullet.alive);
	};

	// Звірка куль зі знімком. Куля з тим самим seq (або id) усиновлюється: стан сервера плюс
	// кроки, на які клієнт попереду. Локальна без пари зникає, коли сервер її вже обробив.
	function syncShots(
		bullets: readonly BulletSnapshot[] | undefined,
		youId: string | null,
		ack: number,
	): void {
		const ahead = pending.length;
		const mine = (bullets ?? []).filter((b) => b.owner === youId);
		const used = new Set<EntityId>();
		const next: Shot[] = [];
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
			if (bullet.alive) next.push({ seq: b.seq ?? NO_SEQ, id: b.id, bullet });
		}
		shots = next;
	}

	return {
		get enabled(): boolean {
			return enabled;
		},
		// зміна стану скидає все: стан підтягнеться з наступного знімка
		set enabled(on: boolean) {
			enabled = Boolean(on);
			clear();
		},
		// сирий передбачений корабель (без зсуву)
		get ship(): Biplane | null {
			return enabled ? plane : null;
		},
		// те, що малюємо: позиція зі зсувом, решта як є (null: передбачення немає)
		get pose(): Pose | null {
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
		get shots(): Bullet[] {
			return enabled ? shots.map((s) => s.bullet) : [];
		},
		get pending(): number {
			return pending.length;
		},
		reset: clear,

		// input щойно надіслано: запам'ятати й одразу застосувати
		step(seq: Seq, keys: PredictorKeys): void {
			if (!enabled) return;
			pending.push({ seq, keys });
			if (pending.length > MAX_PENDING) pending.shift();
			advanceShots(); // нова куля стартує з наступного кроку, як на сервері
			if (!plane) return;
			plane.update(TICK_DT, { ...keys, seq });
			for (const bullet of spawned.splice(0)) {
				// заглушка приймає будь-яку сутність, але Biplane.fire кладе в неї лише кулі
				if (!(bullet instanceof Bullet)) continue;
				shots.push({ seq, id: null, bullet });
				onFire?.({ x: bullet.pos.x, y: bullet.pos.y });
			}
			if (shots.length > MAX_SHOTS) shots.splice(0, shots.length - MAX_SHOTS);
		},

		// згасання зсуву: раз на крок симуляції
		tick(dt: number): void {
			prevOffset = offset;
			if (!(smooth > 0)) return;
			const k = Math.exp((-3 * dt) / smooth);
			const x = offset.x * k;
			const y = offset.y * k;
			offset = Math.hypot(x, y) < 0.01 ? { x: 0, y: 0 } : { x, y };
		},

		// Повертає { reset, correction }: correction це сирий зсув від звірки в px
		// (null: немає що міряти). Згладжування на нього не впливає.
		reconcile(msg: ReconcileInput, youId: string | null): Reconciled {
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
			const before =
				!plane || fresh ? null : { x: plane.pos.x, y: plane.pos.y };
			let current = plane;
			if (!current || fresh) {
				current = new Biplane();
				current.world = stub;
				plane = current;
				planeId = s.id;
				clearOffset(); // відродження: жорстке скидання
			}
			load(current, s);
			for (const p of pending) {
				current.update(TICK_DT, { ...p.keys, seq: p.seq });
				spawned.length = 0; // кулі повтору вже є серед shots
			}

			let correction = 0;
			if (before) {
				// зсув «було мінус стало»: корабель на екрані лишається там, де був
				const dx = wrapDelta(current.pos.x, before.x, ARENA.width);
				const dy = wrapDelta(current.pos.y, before.y, ARENA.height);
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

export type Predictor = ReturnType<typeof createPredictor>;
