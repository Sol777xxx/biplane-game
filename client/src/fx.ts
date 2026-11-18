import { drag, lifetime } from "biplane-shared/sim/behaviors.ts";
import type { Subscribable } from "biplane-shared/sim/bus.ts";
import { Entity } from "biplane-shared/sim/entity.ts";
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
class Explosion extends Entity<"explosion"> {
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

// частинка: звичайний Entity + дві поведінки
class Particle extends Entity<"particle"> {
	readonly color: ExplosionColor;

	constructor({ x, y, vx, vy, color, ttl }: ParticleOptions) {
		super({ kind: "particle", x, y, vx, vy });
		this.color = color;
		this.add(lifetime(ttl)).add(drag(2.5));
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
				new Particle({
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
			return {
				world: {
					*ofKind(kind: string): Generator<T | Entity> {
						yield* game.world.ofKind(kind);
						yield* world.ofKind(kind);
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
