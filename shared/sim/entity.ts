import { ARENA, wrap } from "./arena.ts";
import { type EntityId, NO_ENTITY } from "./ids.ts";
import type { BusEvents, InputState, SimEntity, SimEvent } from "./types.ts";
import { MutableVector2 } from "./vector.ts";

export type EdgeMode = "wrap" | "bounce" | "clamp" | "die";

// Те, що сутність бере у світу. World відповідає цьому інтерфейсу, але entity.ts
// його не імпортує: так немає циклу, і сутність можна перевірити без світу.
export interface EntityWorld {
	readonly events: SimEvent[];
	emit<K extends keyof BusEvents>(type: K, detail: BusEvents[K]): void;
	spawn<E extends Entity>(entity: E): E;
	ofKind(kind: string): Iterable<Entity>;
}

// Поведінка: хуки, які викликає Entity. Сама сутність нічого не знає про конкретні поведінки.
export interface Behavior<S extends Entity = Entity> {
	readonly name: string;
	attach?(self: S): void;
	update?(self: S, dt: number): void;
	onCollide?(self: S, other: SimEntity): void;
}

export interface EntityOptions<K extends string> {
	readonly kind: K;
	readonly x?: number;
	readonly y?: number;
	readonly vx?: number;
	readonly vy?: number;
	readonly angle?: number;
	readonly radius?: number;
	readonly inset?: number; // відступ від краю для режиму "clamp"
	readonly edges?: EdgeMode;
}

// K це літерал виду ("biplane", "bullet"…): підклас фіксує його, і kind стає дискримінантом.
export class Entity<K extends string = string> {
	id: EntityId = NO_ENTITY; // призначає World.spawn: у кожного світу свій лічильник
	readonly kind: K;
	// самі вектори змінні (гаряче місце), але посилання на них не підміняємо
	readonly pos: MutableVector2;
	readonly prevPos: MutableVector2; // для інтерполяції
	readonly vel: MutableVector2;
	angle: number;
	radius: number;
	inset: number;
	edges: EdgeMode;
	alive = true;
	world: EntityWorld | null = null; // заповнює World.spawn
	behaviors: Behavior<this>[] = [];
	life?: number; // 1 → 0, ставить поведінка lifetime

	constructor({
		kind,
		x = 0,
		y = 0,
		vx = 0,
		vy = 0,
		angle = 0,
		radius = 0,
		inset = radius,
		edges = "wrap",
	}: EntityOptions<K>) {
		this.kind = kind;
		this.pos = new MutableVector2(x, y);
		this.prevPos = new MutableVector2(x, y);
		this.vel = new MutableVector2(vx, vy);
		this.angle = angle;
		this.radius = radius;
		this.inset = inset;
		this.edges = edges;
	}

	add(behavior: Behavior<this>): this {
		this.behaviors.push(behavior);
		behavior.attach?.(this);
		return this;
	}

	has(name: string): boolean {
		return this.behaviors.some((b) => b.name === name);
	}

	// input потрібен лише кораблю; World.step передає його всім однаково
	update(dt: number, _input?: InputState): void {
		for (const b of this.behaviors) b.update?.(this, dt);
		this.prevPos.copy(this.pos);
		this.pos.x += this.vel.x * dt;
		this.pos.y += this.vel.y * dt;
		this.#applyEdges();
	}

	// підкласи, які перевизначають onCollide, мають викликати super.onCollide(other)
	onCollide(other: SimEntity): void {
		for (const b of this.behaviors) b.onCollide?.(this, other);
	}

	// шкода; за замовчуванням сутність її ігнорує
	takeDamage(_amount: number, _by: SimEntity | null = null): void {
		// нічого
	}

	kill(): void {
		this.alive = false;
	}

	#applyEdges(): void {
		const { width, height } = ARENA;
		if (this.edges === "die") {
			const { x, y } = this.pos;
			if (x < 0 || x > width || y < 0 || y > height) this.kill();
			return;
		}
		if (this.edges === "clamp") {
			const m = this.inset;
			const p = this.pos;
			const v = this.vel;
			if (p.x < m) {
				p.x = m;
				v.x = Math.max(0, v.x);
			} else if (p.x > width - m) {
				p.x = width - m;
				v.x = Math.min(0, v.x);
			}
			if (p.y < m) {
				p.y = m;
				v.y = Math.max(0, v.y);
			} else if (p.y > height - m) {
				p.y = height - m;
				v.y = Math.min(0, v.y);
			}
			return;
		}
		if (this.edges === "bounce") {
			const r = this.radius;
			if (this.pos.x < r) {
				this.pos.x = r;
				this.vel.x = Math.abs(this.vel.x);
			} else if (this.pos.x > width - r) {
				this.pos.x = width - r;
				this.vel.x = -Math.abs(this.vel.x);
			}
			if (this.pos.y < r) {
				this.pos.y = r;
				this.vel.y = Math.abs(this.vel.y);
			} else if (this.pos.y > height - r) {
				this.pos.y = height - r;
				this.vel.y = -Math.abs(this.vel.y);
			}
		} else {
			this.pos.x = wrap(this.pos.x, width);
			this.pos.y = wrap(this.pos.y, height);
		}
	}
}
