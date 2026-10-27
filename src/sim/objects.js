import { Entity } from "./entity.js";

// перешкода: грозова хмарка, що дрейфує і відбивається від меж арени
export class Obstacle extends Entity {
	constructor({ x, y, vx, vy, radius = 60 }) {
		super({ kind: "obstacle", x, y, vx, vy, radius, edges: "bounce" });
	}

	onCollide(other) {
		if (other.kind !== "biplane") return;
		// тимчасово: наліт знищує хмарку; шкода з'явиться на етапі 4
		this.kill();
		this.world?.events.push({ type: "crash", entity: this, other });
	}
}