import { ARENA } from "./arena.ts";
import { homing } from "./behaviors.ts";
import { EFFECT_NAMES, type EffectName, type Effects } from "./effects.ts";
import { Entity } from "./entity.ts";
import { NO_SEQ, type Seq } from "./ids.ts";
import { Bullet } from "./objects.ts";
import type { InputState, SimEntity } from "./types.ts";
import { Vector2 } from "./vector.ts";

const ACCEL = 650;
const DRAG = 1.6;
const MAX_SPEED = 360;
const MAX_PITCH = 0.45;
const PITCH_SMOOTH = 8;

const MAX_HP = 100;
const FIRE_COOLDOWN = 0.28;
const RAPID_COOLDOWN = 0.09;
const BULLET_SPEED = 720;
const NOSE = 96; // кінчик спінера у спрайті ≈ 60 px × масштаб 1.6

export interface BiplaneOptions {
	readonly x?: number;
	readonly y?: number;
}

export class Biplane extends Entity<"biplane"> {
	#hp = MAX_HP;
	facing = 1;
	pitch = 0;
	prevPitch = 0;
	cooldown = 0;
	effects: Effects = { shield: 0, rapid: 0, homing: 0 }; // секунд, що лишилось
	flash = 0;
	maxHp = MAX_HP;
	inputSeq: Seq = NO_SEQ; // seq input поточного кроку (його ставлять кулі)
	playerId?: string; // ставить Game, коли корабель належить гравцю

	constructor({
		x = ARENA.width / 2,
		y = ARENA.height / 2,
	}: BiplaneOptions = {}) {
		super({ kind: "biplane", x, y, radius: 46 });
	}

	get hp(): number {
		return this.#hp;
	}

	grant(effect: EffectName, seconds: number): void {
		this.effects[effect] = Math.max(this.effects[effect], seconds);
	}

	override takeDamage(amount: number, by: SimEntity | null = null): void {
		if (!this.alive || this.effects.shield > 0) return;
		this.#hp = Math.max(0, this.#hp - amount);
		this.flash = 0.12;
		if (this.#hp === 0) {
			this.alive = false;
			this.world?.events.push({ type: "destroyed", entity: this, by });
		}
	}

	// Повертає кулю або null. Увага: this залежить від місця виклику (див. README).
	fire(): Bullet | null {
		if (!this.alive || this.cooldown > 0 || !this.world) return null;
		this.cooldown = this.effects.rapid > 0 ? RAPID_COOLDOWN : FIRE_COOLDOWN;

		// напрямок носа: дзеркалення (facing) і нахил (pitch), як у рендері
		const dir = new Vector2(
			this.facing * Math.cos(this.pitch),
			Math.sin(this.pitch),
		);
		const muzzle = this.pos.add(dir.scale(NOSE));
		const vel = dir.scale(BULLET_SPEED).add(this.vel); // успадкована швидкість

		const bullet = new Bullet({
			owner: this,
			x: muzzle.x,
			y: muzzle.y,
			vx: vel.x,
			vy: vel.y,
			seq: this.inputSeq,
		});
		if (this.effects.homing > 0) {
			bullet.add(homing({ kinds: ["obstacle"], turnRate: 4, range: 700 }));
		}
		this.world.spawn(bullet);
		this.world.emit("fired", { by: this, at: muzzle });
		return bullet;
	}

	// input.seq необов'язковий: його додає сервер/клієнт, коли крок відповідає реальному input
	override update(dt: number, input: InputState = {}): void {
		this.inputSeq = input.seq ?? NO_SEQ;
		this.cooldown = Math.max(0, this.cooldown - dt);
		this.flash = Math.max(0, this.flash - dt);
		for (const k of EFFECT_NAMES) {
			this.effects[k] = Math.max(0, this.effects[k] - dt);
		}

		const ax = (input.right ? 1 : 0) - (input.left ? 1 : 0);
		const ay = (input.down ? 1 : 0) - (input.up ? 1 : 0);

		this.vel.x += ax * ACCEL * dt;
		this.vel.y += ay * ACCEL * dt;

		const k = Math.max(0, 1 - DRAG * dt);
		this.vel.x *= k;
		this.vel.y *= k;

		const speed = this.vel.length();
		if (speed > MAX_SPEED) {
			this.vel.x = (this.vel.x / speed) * MAX_SPEED;
			this.vel.y = (this.vel.y / speed) * MAX_SPEED;
		}

		if (ax !== 0) this.facing = ax;

		const targetPitch = (this.vel.y / MAX_SPEED) * MAX_PITCH;
		this.prevPitch = this.pitch;
		this.pitch += (targetPitch - this.pitch) * Math.min(1, PITCH_SMOOTH * dt);

		if (input.fire) this.fire();

		super.update(dt);
	}
}
