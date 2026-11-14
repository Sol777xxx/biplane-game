import { lifetime, pickup } from "./behaviors.ts";
import type { Biplane } from "./biplane.ts";
import { EFFECT_NAMES, type EffectName } from "./effects.ts";
import { Entity } from "./entity.ts";
import { NO_SEQ, type Seq } from "./ids.ts";
import type { SimEntity } from "./types.ts";

const BULLET_RADIUS = 8;
const BULLET_DAMAGE = 34;
const BULLET_TTL = 1.6; // с
const CRASH_DAMAGE = 35;

export interface BulletOptions {
	readonly owner: Biplane | null;
	readonly x: number;
	readonly y: number;
	readonly vx: number;
	readonly vy: number;
	readonly damage?: number;
	readonly ttl?: number;
	readonly seq?: Seq; // seq input, що випустив кулю (NO_SEQ: невідомо)
}

export class Bullet extends Entity<"bullet"> {
	readonly owner: Biplane | null;
	damage: number;
	ttl: number;
	readonly seq: Seq;

	constructor({
		owner,
		x,
		y,
		vx,
		vy,
		damage = BULLET_DAMAGE,
		ttl = BULLET_TTL,
		seq = NO_SEQ,
	}: BulletOptions) {
		super({
			kind: "bullet",
			x,
			y,
			vx,
			vy,
			radius: BULLET_RADIUS,
			edges: "die",
		});
		this.owner = owner;
		this.damage = damage;
		this.ttl = ttl;
		this.seq = seq;
	}

	override update(dt: number): void {
		this.ttl -= dt;
		if (this.ttl <= 0) {
			this.kill();
			return;
		}
		super.update(dt);
	}

	override onCollide(other: SimEntity): void {
		super.onCollide(other);
		if (other === this.owner) return;
		if (other.kind === "obstacle" || other.kind === "biplane") {
			other.takeDamage(this.damage, this.owner);
			this.world?.events.push({
				type: "hit",
				at: this.pos.clone(),
				target: other,
			});
			this.world?.emit("hit", { at: this.pos.clone(), target: other });
			this.kill();
		}
	}
}

export interface ObstacleOptions {
	readonly x: number;
	readonly y: number;
	readonly vx: number;
	readonly vy: number;
	readonly radius?: number;
}

export class Obstacle extends Entity<"obstacle"> {
	#hp: number;
	flash = 0;

	constructor({ x, y, vx, vy, radius = 60 }: ObstacleOptions) {
		super({ kind: "obstacle", x, y, vx, vy, radius, edges: "bounce" });
		this.#hp = radius * 1.3;
	}

	get hp(): number {
		return this.#hp;
	}

	override takeDamage(amount: number, by: SimEntity | null = null): void {
		if (!this.alive) return;
		this.#hp = Math.max(0, this.#hp - amount);
		this.flash = 0.12;
		if (this.#hp === 0) {
			this.alive = false;
			this.world?.events.push({ type: "destroyed", entity: this, by });
		}
	}

	override update(dt: number): void {
		this.flash = Math.max(0, this.flash - dt);
		super.update(dt);
	}

	override onCollide(other: SimEntity): void {
		super.onCollide(other);
		if (other.kind !== "biplane" || !this.alive) return;
		other.takeDamage(CRASH_DAMAGE, this);
		this.kill();
		this.world?.events.push({ type: "crash", entity: this, other });
	}
}

// тип бонусу це ім'я ефекту, який він дає
export type PickupType = EffectName;

const PICKUP_EFFECTS: Record<PickupType, (ship: Biplane) => void> = {
	shield: (ship) => ship.grant("shield", 6),
	rapid: (ship) => ship.grant("rapid", 8),
	homing: (ship) => ship.grant("homing", 8),
};
export const PICKUP_TYPES: readonly PickupType[] = EFFECT_NAMES;

export interface PickupOptions {
	readonly x: number;
	readonly y: number;
	readonly type: PickupType;
}

// стоїть, колізиться, але не корабель; логіка підбору це поведінка, а не підклас
export class Pickup extends Entity<"pickup"> {
	readonly type: PickupType;

	constructor({ x, y, type }: PickupOptions) {
		super({ kind: "pickup", x, y, radius: 28 });
		this.type = type;
		this.add(pickup(PICKUP_EFFECTS[type])).add(lifetime(12));
	}
}
