import { drag, lifetime, pickup } from "./behaviors.js";
import { Entity } from "./entity.js";

const BULLET_RADIUS = 8;
const BULLET_DAMAGE = 34;
const BULLET_TTL = 1.6; // с
const CRASH_DAMAGE = 35;

export class Bullet extends Entity {
	constructor({ owner, x, y, vx, vy, damage = BULLET_DAMAGE, ttl = BULLET_TTL }) {
		super({ kind: "bullet", x, y, vx, vy, radius: BULLET_RADIUS, edges: "die" });
		this.owner = owner;
		this.damage = damage;
		this.ttl = ttl;
	}

	update(dt) {
		this.ttl -= dt;
		if (this.ttl <= 0) {
			this.kill();
			return;
		}
		super.update(dt);
	}

	onCollide(other) {
		super.onCollide(other);
		if (other === this.owner) return;
		if (other.kind === "obstacle" || other.kind === "biplane") {
			other.takeDamage(this.damage, this.owner);
			this.world?.events.push({ type: "hit", at: this.pos.clone(), target: other });
			this.kill();
		}
	}
}

export class Obstacle extends Entity {
	#hp;

	constructor({ x, y, vx, vy, radius = 60 }) {
		super({ kind: "obstacle", x, y, vx, vy, radius, edges: "bounce" });
		this.#hp = radius * 1.3;
		this.flash = 0;
	}

	get hp() {
		return this.#hp;
	}

	takeDamage(amount, by = null) {
		if (!this.alive) return;
		this.#hp = Math.max(0, this.#hp - amount);
		this.flash = 0.12;
		if (this.#hp === 0) {
			this.alive = false;
			this.world?.events.push({ type: "destroyed", entity: this, by });
		}
	}

	update(dt) {
		this.flash = Math.max(0, this.flash - dt);
		super.update(dt);
	}

	onCollide(other) {
		super.onCollide(other);
		if (other.kind !== "biplane" || !this.alive) return;
		other.takeDamage(CRASH_DAMAGE, this);
		this.kill();
		this.world?.events.push({ type: "crash", entity: this, other });
	}
}

// короткий візуальний ефект (кільце + спалах); сам нічого не колізить (radius 0)
export class Explosion extends Entity {
	constructor({ x, y, size = 60, color = "pink" }) {
		super({ kind: "explosion", x, y });
		this.size = size;
		this.color = color;
		this.add(lifetime(0.45));
	}
}

// частинка: звичайний Entity + дві поведінки, окремого класу не треба
export function createParticle({ x, y, vx, vy, color, ttl }) {
	const p = new Entity({ kind: "particle", x, y, vx, vy });
	p.color = color;
	return p.add(lifetime(ttl)).add(drag(2.5));
}

const PICKUP_EFFECTS = {
	shield: (ship) => ship.grant("shield", 6),
	rapid: (ship) => ship.grant("rapid", 8),
	homing: (ship) => ship.grant("homing", 8),
};
export const PICKUP_TYPES = Object.keys(PICKUP_EFFECTS);

// стоїть, колізиться, але не корабель; логіка підбору це поведінка, а не підклас
export class Pickup extends Entity {
	constructor({ x, y, type }) {
		super({ kind: "pickup", x, y, radius: 28 });
		this.type = type;
		this.add(pickup(PICKUP_EFFECTS[type])).add(lifetime(12));
	}
}