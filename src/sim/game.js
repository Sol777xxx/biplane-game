import { ARENA } from "./arena.js";
import { Biplane } from "./biplane.js";
import { Obstacle } from "./objects.js";
import { World } from "./world.js";

const OBSTACLE_TARGET = 5;
const REFILL_DELAY = 2; // с до появи нової перешкоди

// правила гри поверх світу
export class Game {
	constructor() {
		this.world = new World();
		this.crashes = 0;
		this.refillIn = REFILL_DELAY;
		this.plane = this.world.spawn(new Biplane());

		for (let i = 0; i < OBSTACLE_TARGET; i++) this.spawnObstacle();
	}

	spawnObstacle() {
		const radius = Math.random() < 0.5 ? 45 : 70;
		const angle = Math.random() * Math.PI * 2;
		const speed = 40 + Math.random() * 70;
		const { x, y } = this.#freePoint(380);
		return this.world.spawn(
			new Obstacle({
				x,
				y,
				vx: Math.cos(angle) * speed,
				vy: Math.sin(angle) * speed,
				radius,
			}),
		);
	}

	step(dt, input) {
		this.world.step(dt, new Map([[this.plane.id, input]]));
		this.#handleEvents();
		this.#refill(dt);
	}

	#handleEvents() {
		for (const ev of this.world.events) {
			if (ev.type === "crash") this.crashes++;
		}
		this.world.events.length = 0;
	}

	// підтримує потрібну кількість перешкод
	#refill(dt) {
		if (this.world.count("obstacle") >= OBSTACLE_TARGET) {
			this.refillIn = REFILL_DELAY;
			return;
		}
		this.refillIn -= dt;
		if (this.refillIn <= 0) {
			this.spawnObstacle();
			this.refillIn = REFILL_DELAY;
		}
	}

	// випадкова точка не ближче minDist від біплана
	#freePoint(minDist) {
		const margin = 120;
		let x = 0;
		let y = 0;
		for (let i = 0; i < 40; i++) {
			x = margin + Math.random() * (ARENA.width - margin * 2);
			y = margin + Math.random() * (ARENA.height - margin * 2);
			const d = Math.hypot(x - this.plane.pos.x, y - this.plane.pos.y);
			if (d >= minDist) break;
		}
		return { x, y };
	}
}