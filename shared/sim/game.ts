import { ARENA } from "./arena.ts";
import { homing } from "./behaviors.ts";
import { Biplane } from "./biplane.ts";
import type { EntityId, Tick } from "./ids.ts";
import { toTick } from "./ids.ts";
import { assertNever } from "./never.ts";
import { Obstacle, PICKUP_TYPES, Pickup } from "./objects.ts";
import { mulberry32, type Rng } from "./random.ts";
import type { ExplosionColor, InputState, SimEntity } from "./types.ts";
import { World } from "./world.ts";

const RESPAWN_DELAY = 2;
const RESPAWN_SHIELD = 2;

export type ArenaConfig = {
	readonly obstacles: number;
	readonly pickupEvery: number;
	readonly homingChance: number;
	readonly speed: number;
	readonly refillEvery: number;
};

type ArenaKey = keyof ArenaConfig;

export const DEFAULT_ARENA: ArenaConfig = {
	obstacles: 5,
	pickupEvery: 8,
	homingChance: 0.3,
	speed: 1,
	refillEvery: 2,
};

const LIMITS: Record<ArenaKey, readonly [min: number, max: number]> = {
	obstacles: [0, 20],
	pickupEvery: [1, 60],
	homingChance: [0, 1],
	speed: [0.2, 3],
	refillEvery: [0.2, 10],
};

const ARENA_KEYS: readonly ArenaKey[] = [
	"obstacles",
	"pickupEvery",
	"homingChance",
	"speed",
	"refillEvery",
];

// Шар налаштувань приходить ззовні (оточення, мережа), тому значення unknown.
export type ArenaLayer = Readonly<Record<string, unknown>> | null | undefined;

// шари перекривають один одного зліва направо; усе, що не число, ігнорується
export function resolveArena(...layers: readonly ArenaLayer[]): ArenaConfig {
	const out: Record<ArenaKey, number> = { ...DEFAULT_ARENA };
	for (const layer of layers) {
		for (const key of ARENA_KEYS) {
			const [min, max] = LIMITS[key];
			const v = layer?.[key];
			if (typeof v === "number" && Number.isFinite(v)) {
				out[key] = Math.min(max, Math.max(min, v));
			}
		}
	}
	out.obstacles = Math.round(out.obstacles);
	return out;
}

// гравець: його корабель і лічильники; корабель після загибелі замінюється новим
export class Player {
	readonly id: string;
	plane: Biplane | null = null;
	score = 0;
	destroyed = 0;
	crashes = 0;
	deaths = 0;
	respawnIn = 0;

	constructor(id: string) {
		this.id = id;
	}
}

export interface GameOptions {
	readonly seed?: number;
}

// Уся випадковість іде з this.rng (seed задає сервер), годинників тут немає,
// крок симуляції фіксований: однаковий input дає однаковий стан скрізь.
export class Game {
	readonly config: ArenaConfig;
	readonly seed: number;
	readonly rng: Rng;
	readonly world: World;
	readonly players = new Map<string, Player>(); // id гравця -> Player
	tick: Tick = toTick(0);
	refillIn: number;
	pickupIn: number;

	constructor(config: ArenaLayer = {}, { seed = 1 }: GameOptions = {}) {
		this.config = resolveArena(config);
		this.seed = seed;
		this.rng = mulberry32(seed);
		this.world = new World();
		this.refillIn = this.config.refillEvery;
		this.pickupIn = this.config.pickupEvery;

		for (let i = 0; i < this.config.obstacles; i++) this.spawnObstacle();
	}

	addPlayer(id: string): Player {
		if (this.players.has(id)) throw new Error(`гравець ${id} уже в грі`);
		const player = new Player(id);
		this.players.set(id, player);
		this.#spawnPlane(player);
		return player;
	}

	removePlayer(id: string): void {
		const player = this.players.get(id);
		if (!player) return;
		if (player.plane) this.world.despawn(player.plane.id);
		this.players.delete(id);
	}

	spawnObstacle(): Obstacle {
		const rnd = this.rng;
		const radius = rnd() < 0.5 ? 45 : 70;
		const angle = rnd() * Math.PI * 2;
		const speed = (40 + rnd() * 70) * this.config.speed;
		const { x, y } = this.#safePoint(380, ["biplane"]);
		const obstacle = new Obstacle({
			x,
			y,
			vx: Math.cos(angle) * speed,
			vy: Math.sin(angle) * speed,
			radius,
		});
		// та сама поведінка, що й у homing-кулі, без нового класу
		if (rnd() < this.config.homingChance) {
			obstacle.add(homing({ kinds: ["biplane"], turnRate: 0.6, range: 900 }));
		}
		return this.world.spawn(obstacle);
	}

	// inputs: Map<id гравця, стан вводу>
	step(
		dt: number,
		inputs: ReadonlyMap<string, InputState | undefined> = new Map(),
	): void {
		this.tick = toTick(this.tick + 1);
		const byEntity = new Map<EntityId, InputState | undefined>();
		for (const p of this.players.values()) {
			if (p.plane?.alive) byEntity.set(p.plane.id, inputs.get(p.id));
		}
		this.world.step(dt, byEntity);
		this.#handleEvents();
		this.#refill(dt);
		this.#respawn(dt);
		this.#spawnPickups(dt);
	}

	#playerOf(entity: SimEntity | null | undefined): Player | undefined {
		if (entity?.kind !== "biplane" || entity.playerId === undefined) {
			return undefined;
		}
		return this.players.get(entity.playerId);
	}

	#handleEvents(): void {
		for (const ev of this.world.events) {
			switch (ev.type) {
				case "crash": {
					const player = this.#playerOf(ev.other);
					if (player) player.crashes++;
					this.world.emit("crash", {
						player: player?.id ?? null,
						at: ev.entity.pos.clone(),
					});
					this.#explode(ev.entity, "storm", 14);
					break;
				}
				case "destroyed": {
					if (ev.entity.kind === "obstacle") {
						const player = this.#playerOf(ev.by);
						if (player) {
							const delta = Math.round(ev.entity.radius);
							player.destroyed++;
							player.score += delta;
							this.world.emit("scored", {
								player: player.id,
								delta,
								total: player.score,
								at: ev.entity.pos.clone(),
							});
						}
						this.#explode(ev.entity, "storm", 26);
					} else if (ev.entity.kind === "biplane") {
						const player = this.#playerOf(ev.entity);
						if (player) {
							player.deaths++;
							player.respawnIn = RESPAWN_DELAY;
						}
						this.#explode(ev.entity, "pink", 50);
					}
					break;
				}
				case "pickup": {
					this.world.emit("pickup", {
						type: ev.entity.type,
						by: ev.by,
						player: ev.by.playerId ?? null,
					});
					break;
				}
				case "hit":
					break; // влучання лише видимий ефект: його вже кинула куля через шину
				default:
					assertNever(ev, "подія кроку");
			}
		}
		this.world.events.length = 0;
	}

	// лише повідомлення: частинки й вибухи малює клієнт (fx.js), у стані гри їх немає
	#explode(entity: SimEntity, color: ExplosionColor, count: number): void {
		this.world.emit("exploded", {
			kind: entity.kind,
			pos: entity.pos.clone(),
			size: entity.radius,
			color,
			count,
		});
	}

	#refill(dt: number): void {
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

	// кожен загиблий гравець відроджується через 2 с у безпечній точці, зі щитом
	#respawn(dt: number): void {
		for (const player of this.players.values()) {
			if (player.plane?.alive) continue;
			player.respawnIn -= dt;
			if (player.respawnIn > 0) continue;
			const plane = this.#spawnPlane(player);
			this.world.emit("respawned", {
				player: player.id,
				at: plane.pos.clone(),
			});
		}
	}

	#spawnPlane(player: Player): Biplane {
		const { x, y } = this.#safePoint(250, ["obstacle", "biplane"]);
		const plane = new Biplane({ x, y });
		plane.playerId = player.id;
		plane.grant("shield", RESPAWN_SHIELD);
		player.plane = this.world.spawn(plane);
		return plane;
	}

	#spawnPickups(dt: number): void {
		if (this.world.count("pickup") > 0) {
			this.pickupIn = this.config.pickupEvery;
			return;
		}
		this.pickupIn -= dt;
		if (this.pickupIn > 0) return;
		const { x, y } = this.#safePoint(150, ["obstacle"]);
		const type = PICKUP_TYPES[Math.floor(this.rng() * PICKUP_TYPES.length)];
		if (type === undefined) return; // noUncheckedIndexedAccess: порожній список видів
		this.world.spawn(new Pickup({ x, y, type }));
		this.pickupIn = this.config.pickupEvery;
	}

	// випадкова точка не ближче minDist (+ радіус) від живих сутностей вказаних видів
	#safePoint(
		minDist: number,
		kinds: readonly string[],
	): { x: number; y: number } {
		const margin = 120;
		let x = 0;
		let y = 0;
		for (let i = 0; i < 40; i++) {
			x = margin + this.rng() * (ARENA.width - margin * 2);
			y = margin + this.rng() * (ARENA.height - margin * 2);
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
