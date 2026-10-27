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
	} = {}) {
		this.kind = kind;
		this.pos = new Vector2(x, y);
		this.prevPos = new Vector2(x, y); // для інтерполяції
		this.vel = new Vector2(vx, vy);
		this.angle = angle;
		this.radius = radius;
		this.alive = true;
	}

	get id() {
		return this.#id;
	}

	update(dt) {
		this.prevPos.copy(this.pos);
		this.pos.x = wrap(this.pos.x + this.vel.x * dt, ARENA.width);
		this.pos.y = wrap(this.pos.y + this.vel.y * dt, ARENA.height);
	}
}
