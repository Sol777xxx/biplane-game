import assert from "node:assert/strict";
import { TypedBus } from "biplane-shared/sim/bus.ts";
import { describe, it } from "vitest";
import { createFx, Particle } from "../src/fx.ts";

const DT = 1 / 60;
const spec = (over = {}) => ({
	x: 10,
	y: 20,
	vx: 100,
	vy: -50,
	color: "pink",
	ttl: 0.1,
	...over,
});

function particles(fx) {
	return [...fx.world.ofKind("particle")];
}

describe("частинки: пул", () => {
	it("життя 1 → 0 і гальмування, як раніше давали поведінки lifetime і drag", () => {
		const fx = createFx(new TypedBus());
		const p = fx.world.spawn(Particle.obtain(spec({ ttl: 0.5 })));
		assert.equal(p.life, 1);
		let left = 0.5;
		let vx = 100;
		for (let i = 0; i < 20; i++) {
			fx.step(DT);
			left -= DT;
			vx *= Math.max(0, 1 - 2.5 * DT);
			assert.equal(p.life, Math.max(0, left / 0.5));
			assert.equal(p.vel.x, vx);
		}
		assert.equal(p.alive, true);
	});

	it("частинка вмирає, коли життя скінчилось, і світ її прибирає", () => {
		const fx = createFx(new TypedBus());
		const p = fx.world.spawn(Particle.obtain(spec({ ttl: 0.1 })));
		for (let i = 0; i < 20; i++) fx.step(DT);
		assert.equal(p.alive, false);
		assert.equal(particles(fx).length, 0);
	});

	it("вибух бере частинки з пулу: ті самі об'єкти, але стан чистий", () => {
		const bus = new TypedBus();
		const fx = createFx(bus);
		const boom = {
			pos: { x: 1, y: 2 },
			size: 40,
			color: "storm",
			count: 12,
			kind: "obstacle",
		};

		bus.emit("exploded", boom);
		const first = particles(fx);
		assert.equal(first.length, 12);
		for (let i = 0; i < 120; i++) fx.step(DT); // усі частинки (ttl до 1,1 с) відживуть
		assert.equal(particles(fx).length, 0);

		bus.emit("exploded", { ...boom, pos: { x: 500, y: 600 }, color: "pink" });
		const second = particles(fx);
		assert.equal(second.length, 12);
		const reused = second.filter((p) => first.includes(p));
		assert.equal(reused.length, 12, "усі 12 частинок узято з пулу");
		for (const p of second) {
			assert.equal(p.alive, true);
			assert.equal(p.life, 1);
			assert.equal(p.color, "pink");
			assert.deepEqual([p.pos.x, p.pos.y], [500, 600]);
			assert.deepEqual([p.prevPos.x, p.prevPos.y], [500, 600]);
		}
	});

	it("частинка, створена через new, у пул не потрапляє", () => {
		const fx = createFx(new TypedBus());
		const mine = fx.world.spawn(new Particle(spec({ ttl: 0.05 })));
		for (let i = 0; i < 10; i++) fx.step(DT);
		assert.equal(mine.alive, false);
		assert.notEqual(Particle.obtain(spec()), mine);
	});
});
