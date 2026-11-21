import { ARENA, wrapDelta } from "./arena.ts";
import type { Biplane } from "./biplane.ts";
import type { Behavior, Entity } from "./entity.ts";
import type { Pickup } from "./objects.ts";

// Поведінка: { name, attach?(self), update?(self, dt), onCollide?(self, other) }
// Entity нічого не знає про конкретні поведінки, лише викликає хуки.

// Зміщення до цілі. Змінний об'єкт, який перезаписують: homing працює на кожному кроці кожної
// самонавідної сутності, а новий { dx, dy } на кожну пару кандидатів тут був би зайвим сміттям.
interface Offset {
	dx: number;
	dy: number;
}

function offsetInto(out: Offset, self: Entity, other: Entity): void {
	if (self.edges === "bounce") {
		out.dx = other.pos.x - self.pos.x;
		out.dy = other.pos.y - self.pos.y;
		return;
	}
	out.dx = wrapDelta(self.pos.x, other.pos.x, ARENA.width);
	out.dy = wrapDelta(self.pos.y, other.pos.y, ARENA.height);
}

// у кулі є owner, в інших сутностей немає: `in` звужує тип без приведення
function ownerOf(self: Entity): unknown {
	return "owner" in self ? self.owner : undefined;
}

const probe: Offset = { dx: 0, dy: 0 }; // зміщення до поточного кандидата
const aim: Offset = { dx: 0, dy: 0 }; // зміщення до найближчої цілі (результат nearest)

// true, якщо ціль знайдено; зміщення до неї лежить в aim (діє до наступного виклику)
function nearest(
	self: Entity,
	kinds: readonly string[],
	range: number,
): boolean {
	if (!self.world) return false;
	const owner = ownerOf(self);
	let found = false;
	let bestD2 = range * range;
	for (const kind of kinds) {
		for (const e of self.world.ofKind(kind)) {
			if (!e.alive || e === owner) continue;
			offsetInto(probe, self, e);
			const d2 = probe.dx * probe.dx + probe.dy * probe.dy;
			if (d2 < bestD2) {
				aim.dx = probe.dx;
				aim.dy = probe.dy;
				bestD2 = d2;
				found = true;
			}
		}
	}
	return found;
}

interface HomingOptions {
	readonly kinds: readonly string[];
	readonly turnRate?: number;
	readonly range?: number;
}

// homing: плавно повертає вектор швидкості до найближчої цілі, швидкість не змінюється
export function homing({
	kinds,
	turnRate = 3,
	range = 600,
}: HomingOptions): Behavior {
	return {
		name: "homing",
		update(self, dt) {
			const speed = self.vel.length();
			if (!nearest(self, kinds, range) || speed === 0) return;
			const current = self.vel.angle();
			let diff = Math.atan2(aim.dy, aim.dx) - current;
			diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // у [-π, π]
			const max = turnRate * dt;
			const turn = Math.max(-max, Math.min(max, diff));
			// те саме, що Vector2.fromAngle(current + turn, speed), але без нового вектора
			const heading = current + turn;
			self.vel.set(Math.cos(heading) * speed, Math.sin(heading) * speed);
		},
	};
}

// self.life: 1 → 0; наприкінці сутність помирає (частинки, вибухи, pickup)
export function lifetime(seconds: number): Behavior {
	let left = seconds;
	return {
		name: "lifetime",
		attach(self) {
			self.life = 1;
		},
		update(self, dt) {
			left -= dt;
			self.life = Math.max(0, left / seconds);
			if (left <= 0) self.kill();
		},
	};
}

export function drag(k: number): Behavior {
	return {
		name: "drag",
		update(self, dt) {
			const f = Math.max(0, 1 - k * dt);
			self.vel.x *= f;
			self.vel.y *= f;
		},
	};
}

// pickup: при дотику корабля застосовує ефект і зникає
export function pickup(apply: (ship: Biplane) => void): Behavior<Pickup> {
	return {
		name: "pickup",
		onCollide(self, other) {
			if (!self.alive || other.kind !== "biplane") return;
			apply(other);
			self.kill();
			self.world?.events.push({ type: "pickup", entity: self, by: other });
		},
	};
}
