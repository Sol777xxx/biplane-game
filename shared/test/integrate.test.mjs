import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ARENA } from "../sim/arena.ts";
import { Biplane } from "../sim/biplane.ts";
import { Entity } from "../sim/entity.ts";
import { TICK_DT } from "../sim/time.ts";
import { World } from "../sim/world.ts";

const DT = TICK_DT;

function assertClose(actual, expected, eps = 1e-9) {
	assert.ok(
		Math.abs(actual - expected) <= eps,
		`очікували ${expected}, отримали ${actual}`,
	);
}

function mover(options) {
	return new Entity({ kind: "mover", radius: 10, ...options });
}

describe("Entity.update: інтегрування руху", () => {
	it("pos += vel * dt", () => {
		const e = mover({ x: 100, y: 200, vx: 60, vy: -30 });
		e.update(0.5);
		assertClose(e.pos.x, 130);
		assertClose(e.pos.y, 185);
	});

	it("швидкість сама не змінюється", () => {
		const e = mover({ x: 100, y: 100, vx: 60, vy: -30 });
		e.update(0.5);
		assert.deepEqual([e.vel.x, e.vel.y], [60, -30]);
	});

	it("prevPos запам'ятовує позицію до кроку (для інтерполяції)", () => {
		const e = mover({ x: 100, y: 200, vx: 60, vy: 0 });
		e.update(0.5);
		assert.deepEqual([e.prevPos.x, e.prevPos.y], [100, 200]);
		e.update(0.5);
		assert.deepEqual([e.prevPos.x, e.prevPos.y], [130, 200]);
	});

	it("dt = 0 не рухає сутність", () => {
		const e = mover({ x: 100, y: 100, vx: 500, vy: 500 });
		e.update(0);
		assert.deepEqual([e.pos.x, e.pos.y], [100, 100]);
	});

	it("кілька дрібних кроків дають той самий шлях, що й один великий (рівномірний рух)", () => {
		const a = mover({ x: 100, y: 100, vx: 90, vy: 45 });
		const b = mover({ x: 100, y: 100, vx: 90, vy: 45 });
		for (let i = 0; i < 30; i++) a.update(DT);
		b.update(1);
		assertClose(a.pos.x, b.pos.x, 1e-9);
		assertClose(a.pos.y, b.pos.y, 1e-9);
	});

	it("поведінки викликаються до руху: нова швидкість діє в цьому ж кроці", () => {
		const e = mover({ x: 100, y: 100 });
		e.add({
			name: "push",
			update(self) {
				self.vel.x = 50;
			},
		});
		e.update(1);
		assert.equal(e.pos.x, 150);
	});

	it("add викликає attach, has знаходить поведінку за іменем", () => {
		const e = mover({});
		let attached = null;
		const result = e.add({
			name: "probe",
			attach(self) {
				attached = self;
			},
		});
		assert.equal(result, e);
		assert.equal(attached, e);
		assert.equal(e.has("probe"), true);
		assert.equal(e.has("other"), false);
	});

	it("onCollide передає зіткнення всім поведінкам", () => {
		const e = mover({});
		const seen = [];
		e.add({ name: "a", onCollide: (_self, other) => seen.push(["a", other]) });
		e.add({ name: "b", onCollide: (_self, other) => seen.push(["b", other]) });
		e.add({ name: "c" }); // без хука: не заважає
		const other = { kind: "pickup" };
		e.onCollide(other);
		assert.deepEqual(seen, [
			["a", other],
			["b", other],
		]);
	});

	it("kill знімає alive, takeDamage за замовчуванням нічого не робить", () => {
		const e = mover({});
		e.takeDamage(1000);
		assert.equal(e.alive, true);
		e.kill();
		assert.equal(e.alive, false);
	});
});

describe("Entity: поведінка на краях арени", () => {
	it("wrap: вихід за праву й нижню межу з'являється з протилежного боку", () => {
		const e = mover({
			x: ARENA.width - 10,
			y: ARENA.height - 10,
			vx: 600,
			vy: 600,
		});
		e.update(0.1); // +60 по обох осях
		assertClose(e.pos.x, 50);
		assertClose(e.pos.y, 50);
	});

	it("wrap: вихід за ліву й верхню межу", () => {
		const e = mover({ x: 5, y: 5, vx: -100, vy: -100 });
		e.update(0.1); // -10
		assertClose(e.pos.x, ARENA.width - 5);
		assertClose(e.pos.y, ARENA.height - 5);
	});

	it("wrap зберігає швидкість", () => {
		const e = mover({ x: ARENA.width - 1, y: 100, vx: 600, vy: 0 });
		e.update(0.1);
		assert.equal(e.vel.x, 600);
	});

	it("bounce: відбиття від кожної з чотирьох стін (з радіусом)", () => {
		const right = mover({
			x: ARENA.width - 12,
			y: 450,
			vx: 300,
			vy: 0,
			edges: "bounce",
		});
		right.update(0.1);
		assert.equal(right.pos.x, ARENA.width - 10);
		assert.equal(right.vel.x, -300);

		const left = mover({ x: 12, y: 450, vx: -300, vy: 0, edges: "bounce" });
		left.update(0.1);
		assert.equal(left.pos.x, 10);
		assert.equal(left.vel.x, 300);

		const bottom = mover({
			x: 800,
			y: ARENA.height - 12,
			vx: 0,
			vy: 300,
			edges: "bounce",
		});
		bottom.update(0.1);
		assert.equal(bottom.pos.y, ARENA.height - 10);
		assert.equal(bottom.vel.y, -300);

		const top = mover({ x: 800, y: 12, vx: 0, vy: -300, edges: "bounce" });
		top.update(0.1);
		assert.equal(top.pos.y, 10);
		assert.equal(top.vel.y, 300);
	});

	it("clamp: тримається в межах inset, швидкість у бік стіни гаситься", () => {
		const e = mover({
			x: ARENA.width - 25,
			y: 25,
			vx: 200,
			vy: -200,
			inset: 20,
		});
		e.edges = "clamp";
		e.update(0.1);
		assert.equal(e.pos.x, ARENA.width - 20);
		assert.equal(e.vel.x, 0);
		assert.equal(e.pos.y, 20);
		assert.equal(e.vel.y, 0);
	});

	it("clamp: рух від стіни не гаситься", () => {
		const e = mover({
			x: 10,
			y: 10,
			vx: 100,
			vy: 100,
			inset: 20,
			edges: "clamp",
		});
		e.update(0.01);
		assert.equal(e.pos.x, 20);
		assert.equal(e.vel.x, 100);
		assert.equal(e.vel.y, 100);
	});

	it("clamp: нижня й ліва стіни", () => {
		const e = mover({
			x: 15,
			y: ARENA.height - 15,
			vx: -50,
			vy: 50,
			inset: 20,
			edges: "clamp",
		});
		e.update(0.1);
		assert.equal(e.pos.x, 20);
		assert.equal(e.vel.x, 0);
		assert.equal(e.pos.y, ARENA.height - 20);
		assert.equal(e.vel.y, 0);
	});

	it("die: за межею арени сутність помирає, всередині живе", () => {
		const inside = mover({
			x: ARENA.width - 20,
			y: 100,
			vx: 100,
			vy: 0,
			edges: "die",
		});
		inside.update(0.1); // +10
		assert.equal(inside.alive, true);

		const outside = mover({
			x: ARENA.width - 5,
			y: 100,
			vx: 100,
			vy: 0,
			edges: "die",
		});
		outside.update(0.1); // +10 → за краєм
		assert.equal(outside.alive, false);

		const top = mover({ x: 100, y: 5, vx: 0, vy: -100, edges: "die" });
		top.update(0.1);
		assert.equal(top.alive, false);
	});

	it("die не загортає позицію", () => {
		const e = mover({
			x: ARENA.width - 5,
			y: 100,
			vx: 100,
			vy: 0,
			edges: "die",
		});
		e.update(0.1);
		assertClose(e.pos.x, ARENA.width + 5);
	});

	it("inset типово дорівнює radius", () => {
		const e = mover({ radius: 33 });
		assert.equal(e.inset, 33);
	});
});

describe("Biplane.update: розгін, опір, ліміт швидкості", () => {
	it("без input корабель, що стоїть, лишається на місці", () => {
		const ship = new Biplane({ x: 800, y: 450 });
		ship.update(DT, {});
		assert.deepEqual([ship.pos.x, ship.pos.y], [800, 450]);
		assert.deepEqual([ship.vel.x, ship.vel.y], [0, 0]);
	});

	it("update без другого аргументу еквівалентний порожньому input", () => {
		const a = new Biplane({ x: 800, y: 450 });
		const b = new Biplane({ x: 800, y: 450 });
		a.update(DT);
		b.update(DT, {});
		assert.deepEqual([a.pos.x, a.vel.x], [b.pos.x, b.vel.x]);
	});

	it("right розганяє: vx = ACCEL·dt, потім опір (1 − DRAG·dt)", () => {
		const ship = new Biplane({ x: 800, y: 450 });
		ship.update(DT, { right: true });
		const expected = 650 * DT * (1 - 1.6 * DT);
		assertClose(ship.vel.x, expected);
		assertClose(ship.pos.x, 800 + expected * DT);
		assert.equal(ship.vel.y, 0);
	});

	it("left і down дають протилежні знаки; одночасні left+right скасовуються", () => {
		const l = new Biplane({ x: 800, y: 450 });
		l.update(DT, { left: true });
		assert.ok(l.vel.x < 0);

		const d = new Biplane({ x: 800, y: 450 });
		d.update(DT, { down: true });
		assert.ok(d.vel.y > 0);

		const u = new Biplane({ x: 800, y: 450 });
		u.update(DT, { up: true });
		assert.ok(u.vel.y < 0);

		const both = new Biplane({ x: 800, y: 450 });
		both.update(DT, { left: true, right: true });
		assert.equal(both.vel.x, 0);
	});

	it("опір гасить швидкість, коли input відпущено", () => {
		const ship = new Biplane({ x: 800, y: 450 });
		ship.vel.set(200, 0);
		ship.update(DT, {});
		assertClose(ship.vel.x, 200 * (1 - 1.6 * DT));
		for (let i = 0; i < 300; i++) ship.update(DT, {});
		assert.ok(ship.vel.length() < 0.01);
	});

	it("швидкість обмежена MAX_SPEED = 360", () => {
		const ship = new Biplane({ x: 800, y: 450 });
		for (let i = 0; i < 300; i++) {
			ship.update(DT, { right: true, down: true });
			assert.ok(ship.vel.length() <= 360 + 1e-9);
		}
		assertClose(ship.vel.length(), 360, 1e-9);
	});

	it("великий dt не робить коефіцієнт опору від'ємним", () => {
		const ship = new Biplane({ x: 800, y: 450 });
		ship.vel.set(100, 100);
		ship.update(10, {}); // 1 − 1.6·10 < 0 → k = 0
		assert.ok(Number.isFinite(ship.vel.x));
		assert.equal(ship.vel.x, 0);
		assert.equal(ship.vel.y, 0);
	});

	it("facing змінюється лише від горизонтального input", () => {
		const ship = new Biplane({ x: 800, y: 450 });
		assert.equal(ship.facing, 1);
		ship.update(DT, { left: true });
		assert.equal(ship.facing, -1);
		ship.update(DT, { up: true });
		assert.equal(ship.facing, -1);
		ship.update(DT, { right: true });
		assert.equal(ship.facing, 1);
	});

	it("pitch слідує за вертикальною швидкістю й не перевищує MAX_PITCH", () => {
		const ship = new Biplane({ x: 800, y: 450 });
		ship.update(DT, { down: true });
		assert.ok(ship.pitch > 0);
		assert.equal(ship.prevPitch, 0);
		for (let i = 0; i < 300; i++) ship.update(DT, { down: true });
		assert.ok(ship.pitch <= 0.45 + 1e-9);
		assert.ok(ship.pitch > 0.4);

		const up = new Biplane({ x: 800, y: 450 });
		for (let i = 0; i < 300; i++) up.update(DT, { up: true });
		assert.ok(up.pitch < -0.4);
	});

	it("inputSeq береться з input, а без seq скидається", () => {
		const ship = new Biplane({ x: 800, y: 450 });
		ship.update(DT, { seq: 42 });
		assert.equal(ship.inputSeq, 42);
		const before = ship.inputSeq;
		ship.update(DT, {});
		assert.notEqual(ship.inputSeq, before);
	});

	it("prevPos корабля = позиція до кроку (інтерполяція працює й для нього)", () => {
		const ship = new Biplane({ x: 800, y: 450 });
		ship.vel.set(100, 0);
		ship.update(DT, {});
		assert.deepEqual([ship.prevPos.x, ship.prevPos.y], [800, 450]);
		assert.ok(ship.pos.x > 800);
	});
});

describe("Biplane: таймери, ефекти, шкода", () => {
	it("flash, cooldown і ефекти спадають з часом і не йдуть нижче нуля", () => {
		const ship = new Biplane({ x: 800, y: 450 });
		ship.flash = 0.1;
		ship.cooldown = 0.1;
		ship.grant("shield", 0.1);
		ship.update(0.05, {});
		assertClose(ship.flash, 0.05);
		assertClose(ship.cooldown, 0.05);
		assertClose(ship.effects.shield, 0.05);
		ship.update(1, {});
		assert.equal(ship.flash, 0);
		assert.equal(ship.cooldown, 0);
		assert.equal(ship.effects.shield, 0);
	});

	it("grant не вкорочує вже довший ефект", () => {
		const ship = new Biplane({ x: 800, y: 450 });
		ship.grant("rapid", 8);
		ship.grant("rapid", 3);
		assert.equal(ship.effects.rapid, 8);
		ship.grant("rapid", 10);
		assert.equal(ship.effects.rapid, 10);
	});

	it("takeDamage: hp падає, flash вмикається, нижче нуля не йде", () => {
		const ship = new Biplane({ x: 800, y: 450 });
		assert.equal(ship.hp, 100);
		ship.takeDamage(30);
		assert.equal(ship.hp, 70);
		assert.equal(ship.flash, 0.12);
		assert.equal(ship.alive, true);
	});

	it("щит блокує шкоду", () => {
		const ship = new Biplane({ x: 800, y: 450 });
		ship.grant("shield", 1);
		ship.takeDamage(50);
		assert.equal(ship.hp, 100);
		assert.equal(ship.flash, 0);
	});

	it("смерть: подія destroyed у світі, повторна шкода нічого не додає", () => {
		const world = new World();
		const ship = world.spawn(new Biplane({ x: 800, y: 450 }));
		ship.takeDamage(1000);
		assert.equal(ship.hp, 0);
		assert.equal(ship.alive, false);
		assert.equal(world.events.length, 1);
		assert.equal(world.events[0].type, "destroyed");
		assert.equal(world.events[0].entity, ship);
		assert.equal(world.events[0].by, null);
		ship.takeDamage(10);
		assert.equal(world.events.length, 1);
	});

	it("смерть без світу не падає", () => {
		const ship = new Biplane({ x: 800, y: 450 });
		ship.takeDamage(1000);
		assert.equal(ship.alive, false);
	});
});

describe("Biplane.fire: куля з урахуванням напрямку й швидкості корабля", () => {
	function armed(options) {
		const world = new World();
		const ship = world.spawn(new Biplane({ x: 800, y: 450, ...options }));
		return { world, ship };
	}

	it("без світу, мертвий або на перезарядці корабель не стріляє", () => {
		assert.equal(new Biplane({ x: 800, y: 450 }).fire(), null);

		const dead = armed().ship;
		dead.alive = false;
		assert.equal(dead.fire(), null);

		const { ship } = armed();
		assert.ok(ship.fire());
		assert.equal(ship.fire(), null); // cooldown 0.28 с
	});

	it("куля вилітає з носа вправо зі швидкістю 720", () => {
		const { ship, world } = armed();
		const bullet = ship.fire();
		assert.equal(bullet.pos.x, 800 + 96);
		assert.equal(bullet.pos.y, 450);
		assert.equal(bullet.vel.x, 720);
		assert.equal(bullet.vel.y, 0);
		assert.equal(bullet.owner, ship);
		assert.equal(world.count("bullet"), 1);
	});

	it("facing = −1 стріляє вліво", () => {
		const { ship } = armed();
		ship.facing = -1;
		const bullet = ship.fire();
		assert.equal(bullet.pos.x, 800 - 96);
		assert.equal(bullet.vel.x, -720);
	});

	it("куля успадковує швидкість корабля", () => {
		const { ship } = armed();
		ship.vel.set(100, 50);
		const bullet = ship.fire();
		assert.equal(bullet.vel.x, 820);
		assert.equal(bullet.vel.y, 50);
	});

	it("нахил (pitch) повертає напрямок пострілу", () => {
		const { ship } = armed();
		ship.pitch = 0.3;
		const bullet = ship.fire();
		assertClose(bullet.vel.x, 720 * Math.cos(0.3));
		assertClose(bullet.vel.y, 720 * Math.sin(0.3));
	});

	it("куля несе seq input, що її випустив", () => {
		const { ship } = armed();
		ship.update(DT, { fire: true, seq: 7 });
		const bullet = [...ship.world.ofKind("bullet")][0];
		assert.equal(bullet.seq, 7);
	});

	it("homing-ефект додає кулі поведінку homing", () => {
		const { ship } = armed();
		ship.grant("homing", 5);
		assert.equal(ship.fire().has("homing"), true);
		const plain = armed().ship;
		assert.equal(plain.fire().has("homing"), false);
	});

	it("update з fire: перший крок стріляє, наступні чекають cooldown", () => {
		const { ship, world } = armed();
		ship.update(DT, { fire: true });
		assert.equal(world.count("bullet"), 1);
		ship.update(DT, { fire: true });
		assert.equal(world.count("bullet"), 1);
	});

	it("rapid-ефект скорочує перезарядку: за 1 с куль більше", () => {
		function shots(rapid) {
			const { ship, world } = armed();
			if (rapid) ship.grant("rapid", 100);
			for (let i = 0; i < 30; i++) ship.update(DT, { fire: true });
			return world.count("bullet");
		}
		assert.ok(shots(true) > shots(false));
		assert.ok(shots(false) >= 3);
	});
});
