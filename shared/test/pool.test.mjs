import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { homing } from "../sim/behaviors.ts";
import { Entity } from "../sim/entity.ts";
import { Bullet, Obstacle } from "../sim/objects.ts";
import { Vector2 } from "../sim/vector.ts";
import { World } from "../sim/world.ts";

const DT = 1 / 60;
const opts = (over = {}) => ({
	owner: null,
	x: 100,
	y: 100,
	vx: 10,
	vy: 0,
	...over,
});

// кулю випускають, вона живе ttl секунд, World.sweep прибирає її й повертає в пул
function fireAndExpire(world, bullet) {
	world.spawn(bullet);
	for (let i = 0; i < 20 && bullet.alive; i++) world.step(DT);
	assert.equal(bullet.alive, false);
	assert.equal(world.get(bullet.id), undefined, "sweep прибрав кулю зі світу");
}

describe("пул куль", () => {
	it("мертва куля повертається в пул і obtain віддає той самий об'єкт", () => {
		const world = new World();
		const first = Bullet.obtain(opts({ ttl: 0.05 }));
		fireAndExpire(world, first);
		assert.equal(Bullet.obtain(opts()), first);
	});

	it("повторно використана куля має чистий стан", () => {
		const world = new World();
		const shooter = { kind: "biplane" };
		const first = Bullet.obtain(
			opts({ ttl: 0.05, owner: shooter, seq: 7, damage: 99 }),
		);
		first.add(homing({ kinds: ["obstacle"] }));
		fireAndExpire(world, first);

		const again = Bullet.obtain(opts({ x: 5, y: 6, vx: 1, vy: 2 }));
		assert.equal(again, first);
		assert.equal(again.alive, true);
		assert.equal(again.world, null);
		assert.equal(again.owner, null);
		assert.equal(again.seq, 0);
		assert.equal(again.damage, 34);
		assert.equal(again.ttl, 1.6);
		assert.deepEqual(
			again.behaviors,
			[],
			"homing від попереднього пострілу не лишився",
		);
		assert.deepEqual([again.pos.x, again.pos.y], [5, 6]);
		assert.deepEqual([again.prevPos.x, again.prevPos.y], [5, 6]);
		assert.deepEqual([again.vel.x, again.vel.y], [1, 2]);

		const oldId = first.id;
		world.spawn(again);
		assert.notEqual(again.id, oldId, "World.spawn дає новий id");
	});

	it("куля, створена через new, у пул не потрапляє", () => {
		const world = new World();
		const mine = new Bullet(opts({ ttl: 0.05 }));
		fireAndExpire(world, mine);
		assert.notEqual(Bullet.obtain(opts()), mine);
	});

	it("одна куля не опиняється в пулі двічі", () => {
		const world = new World();
		const b = Bullet.obtain(opts({ ttl: 0.05 }));
		fireAndExpire(world, b);
		b.recycle();
		b.recycle();
		const x = Bullet.obtain(opts());
		const y = Bullet.obtain(opts());
		assert.notEqual(x, y);
	});

	it("пул обмежений: зайві кулі збирає GC", () => {
		const world = new World();
		const made = Array.from({ length: 300 }, () =>
			Bullet.obtain(opts({ ttl: 0.05 })),
		);
		for (const b of made) world.spawn(b);
		for (let i = 0; i < 10; i++) world.step(DT);
		const set = new Set(made);
		const reused = Array.from({ length: 300 }, () =>
			Bullet.obtain(opts()),
		).filter((b) => set.has(b));
		// у пулі не більше 256: решту (і все, що там було до цього тесту) пул не тримає
		assert.ok(
			reused.length > 200 && reused.length <= 256,
			`повторно взято ${reused.length}`,
		);
	});
});

describe("homing без нових векторів", () => {
	it("вектор швидкості збігається з розрахунком через Vector2.fromAngle", () => {
		const world = new World();
		const target = world.spawn(
			new Obstacle({ x: 600, y: 200, vx: 0, vy: 0, radius: 40 }),
		);
		const seeker = world.spawn(
			new Entity({
				kind: "bullet",
				x: 100,
				y: 100,
				vx: 300,
				vy: 0,
				edges: "wrap",
			}),
		);
		seeker.add(homing({ kinds: ["obstacle"], turnRate: 4, range: 900 }));

		for (let i = 0; i < 90; i++) {
			const speed = seeker.vel.length();
			const current = seeker.vel.angle();
			let diff =
				Math.atan2(target.pos.y - seeker.pos.y, target.pos.x - seeker.pos.x) -
				current;
			diff = Math.atan2(Math.sin(diff), Math.cos(diff));
			const max = 4 * DT;
			const turn = Math.max(-max, Math.min(max, diff));
			const want = Vector2.fromAngle(current + turn, speed);
			// лише поведінки, без руху: порівнюємо швидкість після update
			for (const b of seeker.behaviors) b.update?.(seeker, DT);
			assert.equal(seeker.vel.x, want.x, `крок ${i}`);
			assert.equal(seeker.vel.y, want.y, `крок ${i}`);
		}
		assert.ok(seeker.vel.y > 0, "повернула до цілі");
	});

	it("без цілі в радіусі швидкість не змінюється", () => {
		const world = new World();
		const seeker = world.spawn(new Entity({ kind: "bullet", vx: 100, vy: 50 }));
		seeker.add(homing({ kinds: ["obstacle"], range: 100 }));
		seeker.behaviors[0].update(seeker, DT);
		assert.deepEqual([seeker.vel.x, seeker.vel.y], [100, 50]);
	});
});
