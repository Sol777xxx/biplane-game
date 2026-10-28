import { ARENA, wrap } from "./arena.js";
import { Vector2 } from "./vector.js";

export class Entity {
	// приватний лічильник id
	static #nextId = 1;
	#id = Entity.#nextId++;

	constructor({
		kind = "entity",
		x = 0,
		y = 0,
		vx = 0,
		vy = 0,
		angle = 0,
		radius = 0,
		edges = "wrap", // "wrap" | "bounce"
	} = {}) {
		this.kind = kind;
		this.pos = new Vector2(x, y);
		this.prevPos = new Vector2(x, y); // для інтерполяції
		this.vel = new Vector2(vx, vy);
		this.angle = angle;
		this.radius = radius;
		this.edges = edges;
		this.alive = true;
		this.world = null; // заповнює World.spawn
		this.behaviors = [];
	}

	get id() {
		return this.#id;
	}

		add(behavior) {
		this.behaviors.push(behavior);
		behavior.attach?.(this);
		return this;
	}

	has(name) {
		return this.behaviors.some((b) => b.name === name);
	}

	update(dt) {
		for (const b of this.behaviors) b.update?.(this, dt);
		this.prevPos.copy(this.pos);
		this.pos.x += this.vel.x * dt;
		this.pos.y += this.vel.y * dt;
		this.#applyEdges();
	}

	// підкласи, які перевизначають onCollide, мають викликати super.onCollide(other)
	onCollide(other) {
		for (const b of this.behaviors) b.onCollide?.(this, other);
	}

	// шкода; за замовчуванням сутність її ігнорує
	takeDamage(_amount, _by = null) {
		// нічого
	}

	kill() {
		this.alive = false;
	}

	#applyEdges() {
		const { width, height } = ARENA;
		if (this.edges === "bounce") {
			const r = this.radius;
			if (this.pos.x < r) {
				this.pos.x = r;
				this.vel.x = Math.abs(this.vel.x);
			} else if (this.pos.x > width - r) {
				this.pos.x = width - r;
				this.vel.x = -Math.abs(this.vel.x);
			}
			if (this.pos.y < r) {
				this.pos.y = r;
				this.vel.y = Math.abs(this.vel.y);
			} else if (this.pos.y > height - r) {
				this.pos.y = height - r;
				this.vel.y = -Math.abs(this.vel.y);
			}
		} else {
			this.pos.x = wrap(this.pos.x, width);
			this.pos.y = wrap(this.pos.y, height);
		}
	}
}
