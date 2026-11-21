import { lifetime } from "biplane-shared/sim/behaviors.ts";
import type { Subscribable } from "biplane-shared/sim/bus.ts";
import { Entity } from "biplane-shared/sim/entity.ts";
import { NO_ENTITY } from "biplane-shared/sim/ids.ts";
import type { ExplosionColor } from "biplane-shared/sim/types.ts";
import { World } from "biplane-shared/sim/world.ts";
import type { NetBusEvents } from "./net/events.ts";

// Візуальні ефекти живуть лише на клієнті, у власному світі, і слухають шину подій
// гри. На стан симуляції вони не впливають, тож випадковість тут дозволена.

export type FxEvents = Pick<NetBusEvents, "hit" | "exploded">;

interface ExplosionOptions {
	readonly x: number;
	readonly y: number;
	readonly size?: number;
	readonly color?: ExplosionColor;
}

// короткий візуальний ефект (кільце + спалах); нічого не колізить (radius 0)
export class Explosion extends Entity<"explosion"> {
	readonly size: number;
	readonly color: ExplosionColor;

	constructor({ x, y, size = 60, color = "pink" }: ExplosionOptions) {
		super({ kind: "explosion", x, y });
		this.size = size;
		this.color = color;
		this.add(lifetime(0.45));
	}
}

interface ParticleOptions {
	readonly x: number;
	readonly y: number;
	readonly vx: number;
	readonly vy: number;
	readonly color: ExplosionColor;
	readonly ttl: number;
}

const PARTICLE_DRAG = 2.5;
const PARTICLE_POOL_MAX = 512;
// Вільні частинки: вибух дає десятки штук за раз, і створювати їх (сутність, три вектори,
// масив і дві поведінки) на кожне влучання означало б нове сміття щоразу. Мертва частинка
// повертається сюди з World.sweep, а burst бере звідси.
const spareParticles: Particle[] = [];

// Частинка: життя 1 → 0 і гальмування drag. Раніше це робили поведінки lifetime і drag, але їхній
// стан живе в замиканні, яке не скинути, тож тут ті самі дві формули прямо в update.
export class Particle extends Entity<"particle"> {
	color: ExplosionColor;
	#ttl: number;
	#left: number;
	#pooled = false;
	#spare = false;

	constructor({ x, y, vx, vy, color, ttl }: ParticleOptions) {
		super({ kind: "particle", x, y, vx, vy });
		this.color = color;
		this.#ttl = ttl;
		this.#left = ttl;
		this.life = 1;
	}

	// частинка з пулу або нова, якщо пул порожній
	static obtain(options: ParticleOptions): Particle {
		const spare = spareParticles.pop();
		if (spare === undefined) {
			const fresh = new Particle(options);
			fresh.#pooled = true;
			return fresh;
		}
		spare.#spare = false;
		spare.#reset(options);
		return spare;
	}

	#reset({ x, y, vx, vy, color, ttl }: ParticleOptions): void {
		this.pos.set(x, y);
		this.prevPos.set(x, y);
		this.vel.set(vx, vy);
		this.alive = true;
		this.id = NO_ENTITY;
		this.world = null;
		this.color = color;
		this.#ttl = ttl;
		this.#left = ttl;
		this.life = 1;
	}

	override update(dt: number): void {
		this.#left -= dt;
		this.life = Math.max(0, this.#left / this.#ttl);
		if (this.#left <= 0) this.kill();
		const f = Math.max(0, 1 - PARTICLE_DRAG * dt);
		this.vel.x *= f;
		this.vel.y *= f;
		super.update(dt);
	}

	override recycle(): void {
		if (
			!this.#pooled ||
			this.#spare ||
			spareParticles.length >= PARTICLE_POOL_MAX
		) {
			return;
		}
		this.#spare = true;
		spareParticles.push(this);
	}
}

// Те, що fx бере у гри: список сутностей за видом. Підходить і Game, і snapshotView.
interface HasWorld<T> {
	readonly world: { ofKind(kind: string): Iterable<T> };
}

export function createFx(bus: Subscribable<FxEvents>) {
	const world = new World();

	const burst = (
		pos: { readonly x: number; readonly y: number },
		color: ExplosionColor,
		count: number,
		speed: readonly [min: number, spread: number],
		life: readonly [min: number, spread: number],
	): void => {
		for (let i = 0; i < count; i++) {
			const a = Math.random() * Math.PI * 2;
			const s = speed[0] + Math.random() * speed[1];
			world.spawn(
				Particle.obtain({
					x: pos.x,
					y: pos.y,
					vx: Math.cos(a) * s,
					vy: Math.sin(a) * s,
					color,
					ttl: life[0] + Math.random() * life[1],
				}),
			);
		}
	};

	const offs = [
		bus.on("hit", ({ at, target }) => {
			burst(
				at,
				target.kind === "biplane" ? "pink" : "storm",
				8,
				[60, 200],
				[0.25, 0.25],
			);
		}),
		bus.on("exploded", ({ pos, size, color, count }) => {
			world.spawn(
				new Explosion({ x: pos.x, y: pos.y, size: size * 1.8, color }),
			);
			burst(pos, color, count, [80, 320], [0.5, 0.6]);
		}),
	];

	return {
		world,
		step(dt: number): void {
			world.step(dt);
		},
		// renderer бачить ігровий світ і світ ефектів як один
		view<T>(game: HasWorld<T>) {
			// по одному буферу на вид, що перевикористовується: генератор тут створював
			// об'єкт результату на кожну сутність кожного кадру
			const merged = new Map<string, (T | Particle | Explosion)[]>();
			return {
				world: {
					ofKind(kind: string): readonly (T | Particle | Explosion)[] {
						let out = merged.get(kind);
						if (!out) {
							out = [];
							merged.set(kind, out);
						}
						out.length = 0;
						for (const e of game.world.ofKind(kind)) out.push(e);
						for (const e of world.ofKind(kind)) {
							// у світі ефектів лише частинки й вибухи; instanceof звужує тип без приведення
							if (e instanceof Particle || e instanceof Explosion) out.push(e);
						}
						return out;
					},
				},
			};
		},
		dispose(): void {
			for (const off of offs) off();
		},
	};
}

export type Fx = ReturnType<typeof createFx>;
