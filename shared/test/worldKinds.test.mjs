import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { Entity } from "../sim/entity.ts";
import { World } from "../sim/world.ts";

const make = (kind, x = 0) => new Entity({ kind, x, y: 0, edges: "wrap" });

describe("World: масиви за видами", () => {
	it("ofKind віддає сутності свого виду в порядку створення", () => {
		const w = new World();
		const a = w.spawn(make("bullet", 1));
		w.spawn(make("pickup"));
		const b = w.spawn(make("bullet", 2));
		assert.deepEqual([...w.ofKind("bullet")], [a, b]);
		assert.equal(w.ofKind("pickup").length, 1);
	});

	it("невідомий вид це порожній масив, а не помилка", () => {
		assert.deepEqual([...new World().ofKind("nothing")], []);
	});

	it("світ ітерується в порядку створення, мертві зникають після step", () => {
		const w = new World();
		const a = w.spawn(make("bullet"));
		const b = w.spawn(make("pickup"));
		const c = w.spawn(make("bullet"));
		assert.deepEqual([...w], [a, b, c]);
		b.kill();
		assert.equal(w.size, 3); // видалення відкладене
		w.step(1 / 30);
		assert.deepEqual([...w], [a, c]);
		assert.deepEqual([...w.ofKind("pickup")], []);
		assert.deepEqual([...w.ofKind("bullet")], [a, c]);
		assert.equal(w.size, 2);
		assert.equal(w.get(b.id), undefined);
	});

	it("порядок зберігається, коли гинуть сутності з різних місць", () => {
		const w = new World();
		const es = [1, 2, 3, 4, 5].map((x) => w.spawn(make("bullet", x)));
		es[0].kill();
		es[2].kill();
		es[4].kill();
		w.step(1 / 30);
		assert.deepEqual([...w.ofKind("bullet")], [es[1], es[3]]);
		assert.deepEqual([...w], [es[1], es[3]]);
	});

	it("сутність, створена під час кроку, оновлюється лише з наступного", () => {
		const w = new World();
		const born = [];
		const parent = w.spawn(make("bullet"));
		parent.add({
			name: "spawner",
			update() {
				if (born.length === 0) {
					const child = new Entity({ kind: "bullet", x: 5, vx: 60 });
					born.push(w.spawn(child));
				}
			},
		});
		w.step(1);
		assert.equal(born[0].pos.x, 5); // у перший крок не рухалась
		w.step(1);
		assert.equal(born[0].pos.x, 65);
		assert.equal(w.ofKind("bullet").length, 2);
	});

	it("count рахує лише живих", () => {
		const w = new World();
		const a = w.spawn(make("bullet"));
		w.spawn(make("bullet"));
		a.kill();
		assert.equal(w.count("bullet"), 1);
	});

	it("клієнтський світ частинок: id не повторюються після sweep", () => {
		const w = new World();
		const a = w.spawn(make("particle"));
		a.kill();
		w.step(1 / 30);
		const b = w.spawn(make("particle"));
		assert.notEqual(a.id, b.id);
	});
});
