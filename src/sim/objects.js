import { Entity } from "./entity.js";

const BULLET_RADIUS = 8;
const BULLET_DAMAGE = 34;
const BULLET_TTL = 1.6; // с

// куля з обмеженим часом життя
export class Bullet extends Entity {
	constructor({
		owner,
		x,
		y,
		vx,
		vy,
		damage = BULLET_DAMAGE,
		ttl = BULLET_TTL,
	}) {
		super({ kind: "bullet", x, y, vx, vy, radius: BULLET_RADIUS });
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
		if (other === this.owner) return;
		if (other.kind === "obstacle" || other.kind === "biplane") {
			other.takeDamage(this.damage, this.owner);
			this.kill();
		}
	}
}

// перешкода: грозова хмарка, що дрейфує і відбивається від меж арени
export class Obstacle extends Entity {
	#hp;

	constructor({ x, y, vx, vy, radius = 60 }) {
		super({ kind: "obstacle", x, y, vx, vy, radius, edges: "bounce" });
		this.#hp = radius * 1.3;
		this.flash = 0; // короткий спалах при влученні
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
		if (other.kind !== "biplane") return;
		// тимчасово: наліт знищує хмарку; шкода з'явиться на етапі 4
		this.kill();
		this.world?.events.push({ type: "crash", entity: this, other });
	}
}
