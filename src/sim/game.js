import { ARENA } from "./arena.js";
import { homing } from "./behaviors.js";
import { Biplane } from "./biplane.js";
import {
	createParticle,
	Explosion,
	Obstacle,
	PICKUP_TYPES,
	Pickup,
} from "./objects.js";
import { World } from "./world.js";

const RESPAWN_DELAY = 2;
const RESPAWN_SHIELD = 2;

export const DEFAULT_ARENA = {
	obstacles: 5,
	pickupEvery: 8,
	homingChance: 0.3,
	speed: 1,
	refillEvery: 2,
};

const LIMITS = {
	obstacles: [0, 20],
	pickupEvery: [1, 60],
	homingChance: [0, 1],
	speed: [0.2, 3],
	refillEvery: [0.2, 10],
};

// шари перекривають один одного зліва направо; усе, що не число, ігнорується
export function resolveArena(...layers) {
	const out = { ...DEFAULT_ARENA };
	for (const layer of layers) {
		for (const [key, [min, max]] of Object.entries(LIMITS)) {
			const v = layer?.[key];
			if (typeof v === "number" && Number.isFinite(v)) {
				out[key] = Math.min(max, Math.max(min, v));
			}
		}
	}
	out.obstacles = Math.round(out.obstacles);
	return out;
}

export class Game {
	constructor(config = {}) {
		this.config = resolveArena(config);
		this.world = new World();
		this.crashes = 0;
		this.destroyed = 0;
		this.deaths = 0;
		this.score = 0;
		this.refillIn = this.config.refillEvery;
		this.respawnIn = 0;
		this.pickupIn = this.config.pickupEvery;
		this.plane = this.world.spawn(new Biplane());
		this.shake = 0;

		for (let i = 0; i < this.config.obstacles; i++) this.spawnObstacle();
	}

	spawnObstacle() {
		const radius = Math.random() < 0.5 ? 45 : 70;
		const angle = Math.random() * Math.PI * 2;
		const speed = (40 + Math.random() * 70) * this.config.speed;
		const { x, y } = this.#safePoint(380, ["biplane"]);
		const obstacle = new Obstacle({
			x,
			y,
			vx: Math.cos(angle) * speed,
			vy: Math.sin(angle) * speed,
			radius,
		});
		// та сама поведінка, що й у homing-кулі, без нового класу
		if (Math.random() < this.config.homingChance) {
			obstacle.add(homing({ kinds: ["biplane"], turnRate: 0.6, range: 900 }));
		}
		return this.world.spawn(obstacle);
	}

	step(dt, input) {
		this.shake = Math.max(0, this.shake - dt);
		this.world.step(dt, new Map([[this.plane.id, input]]));
		this.#handleEvents();
		this.#refill(dt);
		this.#respawn(dt);
		this.#spawnPickups(dt);
	}

	#handleEvents() {
		for (const ev of this.world.events) {
			if (ev.type === "hit") {
				const color = ev.target.kind === "biplane" ? "pink" : "storm";
				this.#sparks(ev.at, color, 8);
			} else if (ev.type === "crash") {
				this.crashes++;
				this.world.emit("crash", { at: ev.entity.pos.clone() });
				this.shake = 0.25;
				this.#explode(ev.entity, "storm", 14);
			} else if (ev.type === "destroyed") {
				if (ev.entity.kind === "obstacle") {
					this.destroyed++;
					const delta = Math.round(ev.entity.radius);
					this.score += delta;
					this.world.emit("scored", {
						delta,
						total: this.score,
						at: ev.entity.pos.clone(),
					});
					this.#explode(ev.entity, "storm", 26);
				} else if (ev.entity.kind === "biplane") {
					this.deaths++;
					this.respawnIn = RESPAWN_DELAY;
					this.shake = 0.5;
					this.#explode(ev.entity, "pink", 50);
				}
			} else if (ev.type === "pickup") {
				this.world.emit("pickup", { type: ev.entity.type, by: ev.by });
			}
		}
		this.world.events.length = 0;
	}

	#sparks(pos, color, count) {
		for (let i = 0; i < count; i++) {
			const a = Math.random() * Math.PI * 2;
			const s = 60 + Math.random() * 200;
			this.world.spawn(
				createParticle({
					x: pos.x,
					y: pos.y,
					vx: Math.cos(a) * s,
					vy: Math.sin(a) * s,
					color,
					ttl: 0.25 + Math.random() * 0.25,
				}),
			);
		}
	}

	#explode(entity, color, count) {
		this.world.emit("exploded", {
			kind: entity.kind,
			pos: entity.pos.clone(),
			size: entity.radius,
			color,
		});
		const { x, y } = entity.pos;
		this.world.spawn(new Explosion({ x, y, size: entity.radius * 1.8, color }));
		for (let i = 0; i < count; i++) {
			const a = Math.random() * Math.PI * 2;
			const s = 80 + Math.random() * 320;
			this.world.spawn(
				createParticle({
					x,
					y,
					vx: Math.cos(a) * s,
					vy: Math.sin(a) * s,
					color,
					ttl: 0.5 + Math.random() * 0.6,
				}),
			);
		}
	}

	#refill(dt) {
		if (this.world.count("obstacle") >= this.config.obstacles) {
			this.refillIn = this.config.refillEvery;
			return;
		}
		this.refillIn -= dt;
		if (this.refillIn <= 0) {
			this.spawnObstacle();
			this.refillIn = this.config.refillEvery;
		}
	}

	// респаун через 2 с у випадковій безпечній точці, зі щитом
	#respawn(dt) {
		if (this.plane.alive) return;
		this.respawnIn -= dt;
		if (this.respawnIn > 0) return;
		const { x, y } = this.#safePoint(250, ["obstacle"]);
		this.plane = this.world.spawn(new Biplane({ x, y }));
		this.plane.grant("shield", RESPAWN_SHIELD);
		this.world.emit("respawned", { at: this.plane.pos.clone() });
	}

	#spawnPickups(dt) {
		if (this.world.count("pickup") > 0) {
			this.pickupIn = this.config.pickupEvery;
			return;
		}
		this.pickupIn -= dt;
		if (this.pickupIn > 0) return;
		const { x, y } = this.#safePoint(150, ["obstacle"]);
		const type = PICKUP_TYPES[Math.floor(Math.random() * PICKUP_TYPES.length)];
		this.world.spawn(new Pickup({ x, y, type }));
		this.pickupIn = this.config.pickupEvery;
	}

	// випадкова точка не ближче minDist (+ радіус) від живих сутностей вказаних видів
	#safePoint(minDist, kinds) {
		const margin = 120;
		let x = 0;
		let y = 0;
		for (let i = 0; i < 40; i++) {
			x = margin + Math.random() * (ARENA.width - margin * 2);
			y = margin + Math.random() * (ARENA.height - margin * 2);
			const clear = kinds.every((kind) => {
				for (const e of this.world.ofKind(kind)) {
					if (
						e.alive &&
						Math.hypot(x - e.pos.x, y - e.pos.y) < minDist + e.radius
					) {
						return false;
					}
				}
				return true;
			});
			if (clear) break;
		}
		return { x, y };
	}
}
