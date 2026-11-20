import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ARENA } from "../sim/arena.ts";
import { findCollisions, overlaps } from "../sim/collision.ts";
import { Bullet, Obstacle } from "../sim/objects.ts";
import { TICK_DT } from "../sim/time.ts";
import { World } from "../sim/world.ts";

function circle(x, y, radius, alive = true) {
	return { pos: { x, y }, radius, alive };
}

describe("overlaps: два кола", () => {
	it("порожнеча між колами: не перетинаються", () => {
		assert.equal(overlaps(circle(0, 0, 10), circle(100, 0, 10)), false);
	});

	it("дотик (відстань = сума радіусів): вважається перетином", () => {
		assert.equal(overlaps(circle(0, 0, 10), circle(20, 0, 10)), true);
		// 3-4-5: відстань рівно 5 — без похибки дробів
		assert.equal(overlaps(circle(100, 100, 2), circle(103, 104, 3)), true);
	});

	it("на мікрон далі за дотик: промах", () => {
		assert.equal(overlaps(circle(0, 0, 10), circle(20.001, 0, 10)), false);
		assert.equal(overlaps(circle(100, 100, 2), circle(103, 104, 2.99)), false);
	});

	it("глибоке перекриття й одне коло всередині іншого", () => {
		assert.equal(overlaps(circle(50, 50, 30), circle(60, 55, 30)), true);
		assert.equal(overlaps(circle(50, 50, 100), circle(55, 50, 5)), true);
		assert.equal(overlaps(circle(50, 50, 10), circle(50, 50, 10)), true);
	});

	it("симетрична: overlaps(a, b) = overlaps(b, a)", () => {
		const cases = [
			[circle(0, 0, 10), circle(15, 0, 10)],
			[circle(0, 0, 10), circle(30, 0, 10)],
			[circle(5, 895, 20), circle(1595, 5, 20)],
		];
		for (const [a, b] of cases) assert.equal(overlaps(a, b), overlaps(b, a));
	});

	it("через лівий/правий шов арени", () => {
		const a = circle(5, 450, 10);
		const b = circle(ARENA.width - 5, 450, 10); // віддаль 10 через шов
		assert.equal(overlaps(a, b), true);
		assert.equal(overlaps(a, circle(ARENA.width - 40, 450, 10)), false); // віддаль 45
	});

	it("через верхній/нижній шов арени", () => {
		const a = circle(800, 5, 10);
		const b = circle(800, ARENA.height - 5, 10);
		assert.equal(overlaps(a, b), true);
	});

	it("через кут арени (обидві осі загортаються)", () => {
		const a = circle(3, 4, 3);
		const b = circle(ARENA.width - 0, ARENA.height - 0, 3); // (1600, 900) ≡ (0, 0)
		// відстань до (0, 0) це 5, радіуси 3 + 3 = 6
		assert.equal(overlaps(a, b), true);
		assert.equal(
			overlaps(a, circle(ARENA.width - 1, ARENA.height - 1, 1)),
			false,
		);
	});

	it("приймає Entity-подібні об'єкти з pos як Vec2", () => {
		const e = new Obstacle({ x: 100, y: 100, vx: 0, vy: 0, radius: 20 });
		assert.equal(overlaps(e, circle(130, 100, 10)), true);
		assert.equal(overlaps(e, circle(131, 100, 10)), false);
	});
});

describe("findCollisions: усі пари в сцені", () => {
	it("порожній вхід і одна сутність: пар немає", () => {
		assert.deepEqual(findCollisions([]), []);
		assert.deepEqual(findCollisions([circle(0, 0, 10)]), []);
	});

	it("два кола, що перетинаються, дають одну пару в порядку вставки", () => {
		const a = circle(0, 0, 10);
		const b = circle(15, 0, 10);
		const pairs = findCollisions([a, b]);
		assert.equal(pairs.length, 1);
		assert.equal(pairs[0][0], a);
		assert.equal(pairs[0][1], b);
	});

	it("промах: пар немає", () => {
		assert.deepEqual(
			findCollisions([circle(0, 0, 10), circle(500, 500, 10)]),
			[],
		);
	});

	it("дотик рахується парою", () => {
		assert.equal(
			findCollisions([circle(0, 0, 10), circle(20, 0, 10)]).length,
			1,
		);
	});

	it("мертві й безрозмірні (radius 0) сутності пропускаються", () => {
		const live = circle(0, 0, 10);
		const dead = circle(5, 0, 10, false);
		const dot = circle(2, 0, 0);
		assert.deepEqual(findCollisions([live, dead, dot]), []);
	});

	it("ланцюжок A–B–C: тільки сусідні пари", () => {
		const a = circle(0, 0, 10);
		const b = circle(18, 0, 10);
		const c = circle(36, 0, 10);
		const pairs = findCollisions([a, b, c]);
		assert.equal(pairs.length, 2);
		assert.deepEqual(pairs[0], [a, b]);
		assert.deepEqual(pairs[1], [b, c]);
	});

	it("n кіл в одній точці дають n(n−1)/2 пар, кожна рівно раз", () => {
		const items = Array.from({ length: 6 }, () => circle(100, 100, 5));
		const pairs = findCollisions(items);
		assert.equal(pairs.length, (6 * 5) / 2);
		const seen = new Set(
			pairs.map(([a, b]) => `${items.indexOf(a)}-${items.indexOf(b)}`),
		);
		assert.equal(seen.size, pairs.length);
		for (const [a, b] of pairs) {
			assert.ok(items.indexOf(a) < items.indexOf(b));
		}
	});

	it("працює з будь-яким Iterable (Set, генератор)", () => {
		const a = circle(0, 0, 10);
		const b = circle(5, 0, 10);
		assert.equal(findCollisions(new Set([a, b])).length, 1);
		function* gen() {
			yield a;
			yield b;
		}
		assert.equal(findCollisions(gen()).length, 1);
	});

	it("бачить пару через шов арени", () => {
		const a = circle(5, 450, 10);
		const b = circle(ARENA.width - 5, 450, 10);
		assert.equal(findCollisions([a, b]).length, 1);
	});

	it("World як вхід: колізії між сутностями світу", () => {
		const world = new World();
		const o1 = world.spawn(
			new Obstacle({ x: 100, y: 100, vx: 0, vy: 0, radius: 30 }),
		);
		const o2 = world.spawn(
			new Obstacle({ x: 150, y: 100, vx: 0, vy: 0, radius: 30 }),
		);
		world.spawn(new Obstacle({ x: 900, y: 600, vx: 0, vy: 0, radius: 30 }));
		const pairs = findCollisions(world);
		assert.equal(pairs.length, 1);
		assert.deepEqual(pairs[0], [o1, o2]);
	});
});

// Колізії дискретні: перевіряється лише положення в кінці кроку. Якщо за один крок об'єкт
// пролітає більше, ніж діаметр цілі разом з власним, він «тунелює» крізь неї.
describe("тунелювання швидкої кулі", () => {
	const TARGET_X = 400;

	// рух кулі кроками по осі X, як у Entity.update; повертає true, якщо хоч раз перетнулася
	function flyThrough(speed, startX, target) {
		const bullet = circle(startX, 450, 8);
		for (let i = 0; i < 400; i++) {
			bullet.pos = { x: bullet.pos.x + speed * TICK_DT, y: 450 };
			if (overlaps(bullet, target)) return true;
			if (bullet.pos.x > TARGET_X + 500) return false;
		}
		return false;
	}

	it("звичайна куля (720 px/с, 24 px/крок) влучає в найменшу ціль за будь-якого зсуву", () => {
		const smallest = circle(TARGET_X, 450, 28); // бонус, найменша ціль
		// вікно влучання 2·(28+8)=72 px ширше за крок 24 px: промаху бути не може
		for (let offset = 0; offset < 24; offset += 0.5) {
			assert.equal(
				flyThrough(720, 100 + offset, smallest),
				true,
				`промах при зсуві ${offset}`,
			);
		}
	});

	it("межа без тунелювання: крок < діаметр цілі разом із кулею", () => {
		const target = circle(TARGET_X, 450, 28);
		const window = 2 * (28 + 8);
		const slow = window / 2 / TICK_DT; // крок = половина вікна
		for (let offset = 0; offset < 36; offset += 1) {
			assert.equal(flyThrough(slow, 100 + offset, target), true);
		}
	});

	it("надшвидка куля перестрибує ціль: пари між кадрами не виникає (обмеження)", () => {
		const target = circle(TARGET_X, 450, 28);
		// крок 200 px > 72 px вікна: стрибки 100 → 300 → 500 оминають ціль у 400 ± 36
		assert.equal(flyThrough(6000, 100, target), false);
	});

	it("світ: звичайна куля влучає в перешкоду й розмінює 34 hp", () => {
		const world = new World();
		const obstacle = world.spawn(
			new Obstacle({ x: 400, y: 450, vx: 0, vy: 0, radius: 60 }),
		);
		const bullet = world.spawn(
			new Bullet({ owner: null, x: 370, y: 450, vx: 720, vy: 0 }),
		);
		const hpBefore = obstacle.hp;
		world.step(TICK_DT);
		assert.ok(Math.abs(obstacle.hp - (hpBefore - 34)) < 1e-9);
		assert.equal(bullet.alive, false);
		assert.equal(world.events.filter((e) => e.type === "hit").length, 1);
		assert.equal(world.size, 1); // кулю прибрано sweep-ом
	});

	it("світ: швидка куля (20 000 px/с) перелітає перешкоду, hp не змінюється", () => {
		const world = new World();
		const obstacle = world.spawn(
			new Obstacle({ x: 400, y: 450, vx: 0, vy: 0, radius: 60 }),
		);
		const bullet = world.spawn(
			new Bullet({ owner: null, x: 100, y: 450, vx: 20000, vy: 0 }),
		);
		const hpBefore = obstacle.hp;
		world.step(TICK_DT); // 100 → ≈ 767: ціль лишилась позаду
		assert.equal(obstacle.hp, hpBefore);
		assert.equal(bullet.alive, true);
		assert.equal(world.events.length, 0);
		assert.ok(bullet.pos.x > 700);
	});
});
