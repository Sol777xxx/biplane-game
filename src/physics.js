export const ARENA = { width: 1600, height: 900 };

const ACCEL = 650; // прискорення, px/с²
const DRAG = 1.6; // тертя, 1/с
const MAX_SPEED = 360; // px/с
const MAX_PITCH = 0.45; // максимальний нахил, рад
const PITCH_SMOOTH = 8; // швидкість згладжування нахилу, 1/с

export function createShip() {
	const x = ARENA.width / 2;
	const y = ARENA.height / 2;
	return {
		x,
		y,
		vx: 0,
		vy: 0,
		facing: 1,
		pitch: 0,
		prevX: x,
		prevY: y,
		prevPitch: 0,
	};
}

function wrap(value, max) {
	return ((value % max) + max) % max;
}

export function integrate(ship, input, dt) {
	const ax = (input.right ? 1 : 0) - (input.left ? 1 : 0);
	const ay = (input.down ? 1 : 0) - (input.up ? 1 : 0);

	let vx = ship.vx + ax * ACCEL * dt;
	let vy = ship.vy + ay * ACCEL * dt;

	// тертя: швидкість поступово спадає
	const k = Math.max(0, 1 - DRAG * dt);
	vx *= k;
	vy *= k;

	const speed = Math.hypot(vx, vy);
	if (speed > MAX_SPEED) {
		vx = (vx / speed) * MAX_SPEED;
		vy = (vy / speed) * MAX_SPEED;
	}

	// літак дивиться в бік останнього натиснутого горизонтального напрямку
	const facing = ax !== 0 ? ax : ship.facing;

	// нахил залежить від вертикальної швидкості і плавно наздоганяє ціль
	const targetPitch = (vy / MAX_SPEED) * MAX_PITCH;
	const pitch =
		ship.pitch + (targetPitch - ship.pitch) * Math.min(1, PITCH_SMOOTH * dt);

	return {
		x: wrap(ship.x + vx * dt, ARENA.width),
		y: wrap(ship.y + vy * dt, ARENA.height),
		vx,
		vy,
		facing,
		pitch,
		prevX: ship.x,
		prevY: ship.y,
		prevPitch: ship.pitch,
	};
}
