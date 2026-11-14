import { ARENA, wrapDelta } from "./arena.ts";
import type { Biplane } from "./biplane.ts";
import type { Behavior, Entity } from "./entity.ts";
import type { Pickup } from "./objects.ts";
import { Vector2 } from "./vector.ts";

// Поведінка: { name, attach?(self), update?(self, dt), onCollide?(self, other) }
// Entity нічого не знає про конкретні поведінки, лише викликає хуки.

interface Offset {
	readonly dx: number;
	readonly dy: number;
}

function offset(self: Entity, other: Entity): Offset {
	if (self.edges === "bounce") {
		return { dx: other.pos.x - self.pos.x, dy: other.pos.y - self.pos.y };
	}
	return {
		dx: wrapDelta(self.pos.x, other.pos.x, ARENA.width),
		dy: wrapDelta(self.pos.y, other.pos.y, ARENA.height),
	};
}

// у кулі є owner, в інших сутностей немає: `in` звужує тип без приведення
function ownerOf(self: Entity): unknown {
	return "owner" in self ? self.owner : undefined;
}

function nearest(
	self: Entity,
	kinds: readonly string[],
	range: number,
): Offset | null {
	if (!self.world) return null;
	const owner = ownerOf(self);
	let best: Offset | null = null;
	let bestD2 = range * range;
	for (const kind of kinds) {
		for (const e of self.world.ofKind(kind)) {
			if (!e.alive || e === owner) continue;
			const { dx, dy } = offset(self, e);
			const d2 = dx * dx + dy * dy;
			if (d2 < bestD2) {
				best = { dx, dy };
				bestD2 = d2;
			}
		}
	}
	return best;
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
			const target = nearest(self, kinds, range);
			if (!target || speed === 0) return;
			const current = self.vel.angle();
			let diff = Math.atan2(target.dy, target.dx) - current;
			diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // у [-π, π]
			const max = turnRate * dt;
			const turn = Math.max(-max, Math.min(max, diff));
			self.vel.copy(Vector2.fromAngle(current + turn, speed));
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
