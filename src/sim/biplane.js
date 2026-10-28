import { ARENA } from "./arena.js";
import { homing } from "./behaviors.js";
import { Entity } from "./entity.js";
import { Bullet } from "./objects.js";
import { Vector2 } from "./vector.js";

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

export class Biplane extends Entity {
	#hp = MAX_HP;

	constructor({ x = ARENA.width / 2, y = ARENA.height / 2 } = {}) {
		super({ kind: "biplane", x, y, radius: 46, edges: "clamp", inset: 90 });
		this.facing = 1;
		this.pitch = 0;
		this.prevPitch = 0;
		this.cooldown = 0;
		this.effects = { shield: 0, rapid: 0, homing: 0 }; // секунд, що лишилось
		this.flash = 0;
		this.maxHp = MAX_HP;
	}

	get hp() {
		return this.#hp;
	}

	grant(effect, seconds) {
		this.effects[effect] = Math.max(this.effects[effect], seconds);
	}

	takeDamage(amount, by = null) {
		if (!this.alive || this.effects.shield > 0) return;
		this.#hp = Math.max(0, this.#hp - amount);
		this.flash = 0.12;
		if (this.#hp === 0) {
			this.alive = false;
			this.world?.events.push({ type: "destroyed", entity: this, by });
		}
	}

	// Повертає кулю або null. Увага: this залежить від місця виклику (див. README).
	fire() {
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
		});
		if (this.effects.homing > 0) {
			bullet.add(homing({ kinds: ["obstacle"], turnRate: 4, range: 700 }));
		}
		return this.world.spawn(bullet);
	}

	update(dt, input = {}) {
		this.cooldown = Math.max(0, this.cooldown - dt);
		this.flash = Math.max(0, this.flash - dt);
		for (const k of Object.keys(this.effects)) {
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
