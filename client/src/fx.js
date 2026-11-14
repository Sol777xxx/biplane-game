import { drag, lifetime } from "biplane-shared/sim/behaviors.ts";
import { Entity } from "biplane-shared/sim/entity.ts";
import { World } from "biplane-shared/sim/world.js";

// Візуальні ефекти живуть лише на клієнті, у власному світі, і слухають шину подій
// гри. На стан симуляції вони не впливають, тож випадковість тут дозволена.

// короткий візуальний ефект (кільце + спалах); нічого не колізить (radius 0)
class Explosion extends Entity {
	constructor({ x, y, size = 60, color = "pink" }) {
		super({ kind: "explosion", x, y });
		this.size = size;
		this.color = color;
		this.add(lifetime(0.45));
	}
}

// частинка: звичайний Entity + дві поведінки
function createParticle({ x, y, vx, vy, color, ttl }) {
	const p = new Entity({ kind: "particle", x, y, vx, vy });
	p.color = color;
	return p.add(lifetime(ttl)).add(drag(2.5));
}

export function createFx(bus) {
	const world = new World();

	function sparks(pos, color, count) {
		for (let i = 0; i < count; i++) {
			const a = Math.random() * Math.PI * 2;
			const s = 60 + Math.random() * 200;
			world.spawn(
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

	function onHit(e) {
		const { at, target } = e.detail;
		sparks(at, target.kind === "biplane" ? "pink" : "storm", 8);
	}

	function onExploded(e) {
		const { pos, size, color, count } = e.detail;
		world.spawn(new Explosion({ x: pos.x, y: pos.y, size: size * 1.8, color }));
		for (let i = 0; i < count; i++) {
			const a = Math.random() * Math.PI * 2;
			const s = 80 + Math.random() * 320;
			world.spawn(
				createParticle({
					x: pos.x,
					y: pos.y,
					vx: Math.cos(a) * s,
					vy: Math.sin(a) * s,
					color,
					ttl: 0.5 + Math.random() * 0.6,
				}),
			);
		}
	}

	bus.addEventListener("hit", onHit);
	bus.addEventListener("exploded", onExploded);

	return {
		world,
		step(dt) {
			world.step(dt);
		},
		// renderer бачить ігровий світ і світ ефектів як один
		view(game) {
			return {
				world: {
					*ofKind(kind) {
						yield* game.world.ofKind(kind);
						yield* world.ofKind(kind);
					},
				},
			};
		},
		dispose() {
			bus.removeEventListener("hit", onHit);
			bus.removeEventListener("exploded", onExploded);
		},
	};
}
