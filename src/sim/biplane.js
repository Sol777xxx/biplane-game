import { ARENA } from "./arena.js";
import { Entity } from "./entity.js";

const ACCEL = 650; // px/с²
const DRAG = 1.6; // 1/с
const MAX_SPEED = 360; // px/с
const MAX_PITCH = 0.45; // рад
const PITCH_SMOOTH = 8; // 1/с

export class Biplane extends Entity {
	constructor() {
		super({
			kind: "biplane",
			x: ARENA.width / 2,
			y: ARENA.height / 2,
			radius: 46,
		});
		this.facing = 1;
		this.pitch = 0;
		this.prevPitch = 0;
	}

	update(dt, input = {}) {
		const ax = (input.right ? 1 : 0) - (input.left ? 1 : 0);
		const ay = (input.down ? 1 : 0) - (input.up ? 1 : 0);

		this.vel.x += ax * ACCEL * dt;
		this.vel.y += ay * ACCEL * dt;

		// тертя
		const k = Math.max(0, 1 - DRAG * dt);
		this.vel.x *= k;
		this.vel.y *= k;

		const speed = this.vel.length();
		if (speed > MAX_SPEED) {
			this.vel.x = (this.vel.x / speed) * MAX_SPEED;
			this.vel.y = (this.vel.y / speed) * MAX_SPEED;
		}

		// напрямок за останнім горизонтальним вводом
		if (ax !== 0) this.facing = ax;

		// нахил залежить від вертикальної швидкості
		const targetPitch = (this.vel.y / MAX_SPEED) * MAX_PITCH;
		this.prevPitch = this.pitch;
		this.pitch += (targetPitch - this.pitch) * Math.min(1, PITCH_SMOOTH * dt);

		super.update(dt); // зберегти prevPos, перемістити, загорнути
	}
}
