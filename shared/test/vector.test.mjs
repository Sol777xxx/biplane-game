import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { wrap, wrapDelta } from "../sim/arena.ts";
import { MutableVector2, Vector2 } from "../sim/vector.ts";

const EPS = 1e-9;

function assertClose(actual, expected, eps = EPS) {
	assert.ok(
		Math.abs(actual - expected) <= eps,
		`очікували ${expected}, отримали ${actual}`,
	);
}

describe("Vector2: незмінне значення", () => {
	it("конструктор: типово (0, 0)", () => {
		const v = new Vector2();
		assert.equal(v.x, 0);
		assert.equal(v.y, 0);
		const w = new Vector2(3, -4);
		assert.equal(w.x, 3);
		assert.equal(w.y, -4);
	});

	it("add і sub повертають новий вектор і не міняють операнди", () => {
		const a = new Vector2(1, 2);
		const b = new Vector2(10, 20);
		const sum = a.add(b);
		const diff = b.sub(a);
		assert.deepEqual([sum.x, sum.y], [11, 22]);
		assert.deepEqual([diff.x, diff.y], [9, 18]);
		assert.notEqual(sum, a);
		assert.deepEqual([a.x, a.y], [1, 2]);
		assert.deepEqual([b.x, b.y], [10, 20]);
	});

	it("add і sub приймають і звичайний об'єкт { x, y }", () => {
		const v = new Vector2(1, 1).add({ x: 2, y: 3 }).sub({ x: 1, y: 1 });
		assert.deepEqual([v.x, v.y], [2, 3]);
	});

	it("scale і dot", () => {
		const v = new Vector2(2, -3);
		const s = v.scale(-2);
		assert.deepEqual([s.x, s.y], [-4, 6]);
		assert.equal(v.dot({ x: 4, y: 5 }), 2 * 4 + -3 * 5);
		assert.equal(new Vector2(1, 0).dot({ x: 0, y: 1 }), 0); // перпендикулярні
	});

	it("length: єгипетський трикутник 3-4-5 і нульовий вектор", () => {
		assert.equal(new Vector2(3, 4).length(), 5);
		assert.equal(new Vector2(-3, -4).length(), 5);
		assert.equal(new Vector2().length(), 0);
	});

	it("angle: чотири сторони світу", () => {
		assertClose(new Vector2(1, 0).angle(), 0);
		assertClose(new Vector2(0, 1).angle(), Math.PI / 2);
		assertClose(new Vector2(-1, 0).angle(), Math.PI);
		assertClose(new Vector2(0, -1).angle(), -Math.PI / 2);
	});

	it("fromAngle: напрямок і довжина; довжина типово 1", () => {
		const right = Vector2.fromAngle(0);
		assertClose(right.x, 1);
		assertClose(right.y, 0);
		const down = Vector2.fromAngle(Math.PI / 2, 5);
		assertClose(down.x, 0);
		assertClose(down.y, 5);
		assertClose(Vector2.fromAngle(1.234, 7).length(), 7);
	});

	it("normalize: одинична довжина, той самий напрямок", () => {
		const n = new Vector2(3, 4).normalize();
		assertClose(n.length(), 1);
		assertClose(n.x, 0.6);
		assertClose(n.y, 0.8);
	});

	it("normalize нульового вектора дає (0, 0), а не NaN", () => {
		const n = new Vector2().normalize();
		assert.equal(n.x, 0);
		assert.equal(n.y, 0);
	});

	it("rotate: на 90° і на 360°, довжина зберігається", () => {
		const r = new Vector2(1, 0).rotate(Math.PI / 2);
		assertClose(r.x, 0);
		assertClose(r.y, 1);
		const full = new Vector2(3, 4).rotate(2 * Math.PI);
		assertClose(full.x, 3);
		assertClose(full.y, 4);
		assertClose(new Vector2(3, 4).rotate(0.7).length(), 5);
	});

	it("clone: окремий об'єкт з тими самими координатами", () => {
		const v = new Vector2(5, 6);
		const c = v.clone();
		assert.notEqual(c, v);
		assert.deepEqual([c.x, c.y], [5, 6]);
		assert.ok(c instanceof Vector2);
	});
});

describe("MutableVector2: змінний вектор для стану сутності", () => {
	it("set, copy, addInPlace міняють сам вектор і повертають this", () => {
		const v = new MutableVector2(1, 1);
		assert.equal(v.set(5, 6), v);
		assert.deepEqual([v.x, v.y], [5, 6]);
		assert.equal(v.copy({ x: 7, y: 8 }), v);
		assert.deepEqual([v.x, v.y], [7, 8]);
		assert.equal(v.addInPlace({ x: 1, y: -2 }), v);
		assert.deepEqual([v.x, v.y], [8, 6]);
	});

	it("copy знімає залежність від джерела", () => {
		const src = new MutableVector2(1, 2);
		const dst = new MutableVector2().copy(src);
		src.set(100, 200);
		assert.deepEqual([dst.x, dst.y], [1, 2]);
	});

	it("чисті методи не міняють змінний вектор", () => {
		const v = new MutableVector2(1, 2);
		const sum = v.add({ x: 1, y: 1 });
		assert.deepEqual([v.x, v.y], [1, 2]);
		assert.deepEqual([sum.x, sum.y], [2, 3]);
		assert.equal(sum instanceof MutableVector2, false);
	});

	it("clone змінного вектора дає незмінний Vector2, який не слідує за оригіналом", () => {
		const v = new MutableVector2(1, 2);
		const c = v.clone();
		v.set(9, 9);
		assert.equal(c instanceof MutableVector2, false);
		assert.ok(c instanceof Vector2);
		assert.deepEqual([c.x, c.y], [1, 2]);
	});
});

describe("arena: wrap і wrapDelta", () => {
	it("wrap повертає значення в [0, max), у тому числі для від'ємних", () => {
		assert.equal(wrap(0, 1600), 0);
		assert.equal(wrap(1599, 1600), 1599);
		assert.equal(wrap(1600, 1600), 0);
		assert.equal(wrap(1601, 1600), 1);
		assert.equal(wrap(-1, 1600), 1599);
		assert.equal(wrap(-1601, 1600), 1599);
		assert.equal(wrap(3200 + 5, 1600), 5);
	});

	it("wrapDelta: без загортання це звичайна різниця зі знаком", () => {
		assert.equal(wrapDelta(100, 300, 1600), 200);
		assert.equal(wrapDelta(300, 100, 1600), -200);
		assert.equal(wrapDelta(50, 50, 1600), 0);
	});

	it("wrapDelta: через шов арени шлях коротший", () => {
		assert.equal(wrapDelta(10, 1590, 1600), -20);
		assert.equal(wrapDelta(1590, 10, 1600), 20);
		assert.equal(wrapDelta(0, 1599, 1600), -1);
	});

	it("wrapDelta: рівно половина арени не загортається", () => {
		assert.equal(wrapDelta(0, 800, 1600), 800);
		assert.equal(wrapDelta(800, 0, 1600), -800);
		// на один піксель далі і коротший шлях уже через шов
		assert.equal(wrapDelta(0, 801, 1600), -799);
	});

	it("wrapDelta антисиметрична поза межею в половину арени", () => {
		for (const [a, b] of [
			[10, 1590],
			[100, 300],
			[1500, 20],
			[0, 799],
		]) {
			assert.equal(wrapDelta(a, b, 1600), -wrapDelta(b, a, 1600));
		}
	});

	it("модуль wrapDelta ніколи не перевищує max / 2", () => {
		for (let a = 0; a < 900; a += 37) {
			for (let b = 0; b < 900; b += 53) {
				assert.ok(Math.abs(wrapDelta(a, b, 900)) <= 450);
			}
		}
	});
});
