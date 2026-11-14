// Читання координат: підходить і Vector2, і звичайний об'єкт { x, y } (структурна типізація).
export interface Vec2 {
	readonly x: number;
	readonly y: number;
}

// Незмінне значення: поля readonly, усі методи чисті (this і аргумент не змінюються).
export class Vector2 implements Vec2 {
	readonly x: number;
	readonly y: number;

	constructor(x = 0, y = 0) {
		this.x = x;
		this.y = y;
	}

	static fromAngle(angle: number, length = 1): Vector2 {
		return new Vector2(Math.cos(angle) * length, Math.sin(angle) * length);
	}

	add(v: Vec2): Vector2 {
		return new Vector2(this.x + v.x, this.y + v.y);
	}

	sub(v: Vec2): Vector2 {
		return new Vector2(this.x - v.x, this.y - v.y);
	}

	scale(k: number): Vector2 {
		return new Vector2(this.x * k, this.y * k);
	}

	dot(v: Vec2): number {
		return this.x * v.x + this.y * v.y;
	}

	length(): number {
		return Math.hypot(this.x, this.y);
	}

	angle(): number {
		return Math.atan2(this.y, this.x);
	}

	normalize(): Vector2 {
		const len = this.length();
		return len === 0 ? new Vector2() : this.scale(1 / len);
	}

	rotate(angle: number): Vector2 {
		const c = Math.cos(angle);
		const s = Math.sin(angle);
		return new Vector2(this.x * c - this.y * s, this.x * s + this.y * c);
	}

	// копія завжди незмінна: так знімок позиції (подія, знімок гри) не зміниться ззовні
	clone(): Vector2 {
		return new Vector2(this.x, this.y);
	}
}

// Змінний вектор для стану сутності (pos, prevPos, vel): його міняють на кожному кроці
// без нових об'єктів. Назовні віддаємо як Vec2 або clone() (це вже незмінний Vector2).
export class MutableVector2 extends Vector2 {
	// declare лише знімає readonly у типі: поля створює конструктор Vector2
	declare x: number;
	declare y: number;

	set(x: number, y: number): this {
		this.x = x;
		this.y = y;
		return this;
	}

	copy(v: Vec2): this {
		return this.set(v.x, v.y);
	}

	addInPlace(v: Vec2): this {
		this.x += v.x;
		this.y += v.y;
		return this;
	}
}
