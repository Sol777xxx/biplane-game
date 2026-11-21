import { lifetime, pickup } from "./behaviors.ts";
import type { Biplane } from "./biplane.ts";
import { EFFECT_NAMES, type EffectName } from "./effects.ts";
import { Entity } from "./entity.ts";
import { NO_ENTITY, NO_SEQ, type Seq } from "./ids.ts";
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

// Вільні кулі: стрільба бере звідси, а World.sweep повертає мертві. Так бій із десятками куль
// на секунду не створює об'єкт і три вектори на кожен постріл. Межа не дає пулу розростись.
const BULLET_POOL_MAX = 256;
const spareBullets: Bullet[] = [];

export class Bullet extends Entity<"bullet"> {
	// не readonly: куля з пулу отримує нового власника й seq при повторному використанні
	owner: Biplane | null;
	damage: number;
	ttl: number;
	seq: Seq;
	#pooled = false; // створена через Bullet.obtain: після смерті повернеться в пул
	#spare = false; // зараз лежить у пулі

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

	// Куля з пулу або нова, якщо пул порожній. Стан після obtain такий самий, як після new Bullet.
	static obtain(options: BulletOptions): Bullet {
		const spare = spareBullets.pop();
		if (spare === undefined) {
			const fresh = new Bullet(options);
			fresh.#pooled = true;
			return fresh;
		}
		spare.#spare = false;
		spare.#reset(options);
		return spare;
	}

	#reset({
		owner,
		x,
		y,
		vx,
		vy,
		damage = BULLET_DAMAGE,
		ttl = BULLET_TTL,
		seq = NO_SEQ,
	}: BulletOptions): void {
		this.pos.set(x, y);
		this.prevPos.set(x, y);
		this.vel.set(vx, vy);
		this.alive = true;
		this.id = NO_ENTITY; // новий id призначить World.spawn
		this.world = null;
		this.behaviors.length = 0; // homing лишився б від попереднього пострілу
		this.owner = owner;
		this.damage = damage;
		this.ttl = ttl;
		this.seq = seq;
	}

	// Повертає себе в пул лише якщо створена через obtain: кулі з new (передбачення на клієнті,
	// тести) тримає той, хто їх створив, і чужа посилання на них не повинна оживати.
	override recycle(): void {
		if (
			!this.#pooled ||
			this.#spare ||
			spareBullets.length >= BULLET_POOL_MAX
		) {
			return;
		}
		this.#spare = true;
		spareBullets.push(this);
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
			// одна незмінна копія на подію й на шину: Vector2 ззовні не змінюється
			const at = this.pos.clone();
			this.world?.events.push({ type: "hit", at, target: other });
			this.world?.emit("hit", { at, target: other });
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
