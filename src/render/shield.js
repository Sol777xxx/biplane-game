const TAU = Math.PI * 2;

// півосі щита: витягнутий горизонтально, приплюснутий по вертикалі
export const SHIELD_RX = 124;
export const SHIELD_RY = 88;

const MERIDIANS = 8;
const LATITUDES = [-60, -30, 0, 30, 60]; // градуси
const TILT = 0.45;
const SEG = 56;

// точка сфери (широта, довгота) з нахилом навколо осі X → [x, y, z]
function spherePoint(phi, theta) {
	const x = Math.cos(phi) * Math.sin(theta);
	const y = Math.sin(phi);
	const z = Math.cos(phi) * Math.cos(theta);
	const c = Math.cos(TILT);
	const s = Math.sin(TILT);
	return [x, y * c - z * s, y * s + z * c];
}

// додає ламану лінію у front/back залежно від глибини сегмента
function addCurve(front, back, r, pts) {
	for (let i = 0; i < pts.length - 1; i++) {
		const [x1, y1, z1] = pts[i];
		const [x2, y2, z2] = pts[i + 1];
		const path = z1 + z2 >= 0 ? front : back;
		path.moveTo(x1 * r, -y1 * r);
		path.lineTo(x2 * r, -y2 * r);
	}
}

// remaining: секунд до кінця щита (наприкінці блимає)
export function drawShield(ctx, cx, cy, rx, ry, time, remaining) {
	if (remaining < 1.5 && Math.floor(time / 100) % 2 === 0) return;

	const r = rx; // рахуємо для кола, потім розтягуємо в еліпс
	const pulse = 0.85 + 0.15 * Math.sin(time * 0.004);
	const spin = time * 0.0007;

	ctx.save();
	ctx.translate(cx, cy);
	ctx.scale(1, ry / rx);
	ctx.lineCap = "round";
	ctx.lineJoin = "round";

	// скляна поверхня
	const glass = ctx.createRadialGradient(0, 0, r * 0.5, 0, 0, r);
	glass.addColorStop(0, "rgba(130, 220, 190, 0)");
	glass.addColorStop(0.75, `rgba(130, 220, 190, ${0.08 * pulse})`);
	glass.addColorStop(1, `rgba(170, 245, 215, ${0.3 * pulse})`);
	ctx.fillStyle = glass;
	ctx.beginPath();
	ctx.arc(0, 0, r, 0, TAU);
	ctx.fill();

	const front = new Path2D();
	const back = new Path2D();

	// меридіани
	for (let m = 0; m < MERIDIANS; m++) {
		const theta = spin + (m * Math.PI) / MERIDIANS;
		const pts = [];
		for (let i = 0; i <= SEG; i++) {
			pts.push(spherePoint((i / SEG) * TAU, theta));
		}
		addCurve(front, back, r, pts);
	}

	// паралелі
	for (const deg of LATITUDES) {
		const phi = (deg * Math.PI) / 180;
		const pts = [];
		for (let i = 0; i <= SEG; i++) {
			pts.push(spherePoint(phi, (i / SEG) * TAU));
		}
		addCurve(front, back, r, pts);
	}

	// задня половина
	ctx.strokeStyle = `rgba(95, 184, 154, ${0.3 * pulse})`;
	ctx.lineWidth = 1.1;
	ctx.stroke(back);

	// передня половина
	ctx.strokeStyle = `rgba(130, 220, 190, ${0.28 * pulse})`;
	ctx.lineWidth = 5;
	ctx.stroke(front);
	ctx.strokeStyle = `rgba(200, 255, 235, ${0.9 * pulse})`;
	ctx.lineWidth = 1.5;
	ctx.stroke(front);

	// сканувальне кільце
	const scanPhi = Math.sin(time * 0.0012) * 1.1;
	const scan = [];
	for (let i = 0; i <= SEG; i++) {
		scan.push(spherePoint(scanPhi, (i / SEG) * TAU));
	}
	const scanFront = new Path2D();
	addCurve(scanFront, new Path2D(), r, scan);
	ctx.strokeStyle = `rgba(210, 255, 240, ${0.35 * pulse})`;
	ctx.lineWidth = 6;
	ctx.stroke(scanFront);
	ctx.strokeStyle = `rgba(255, 255, 255, ${0.9 * pulse})`;
	ctx.lineWidth = 1.8;
	ctx.stroke(scanFront);

	// вузли
	for (let m = 0; m < MERIDIANS; m++) {
		const theta = spin + (m * Math.PI) / MERIDIANS;
		for (const side of [0, Math.PI]) {
			for (const deg of LATITUDES) {
				const [x, y, z] = spherePoint((deg * Math.PI) / 180, theta + side);
				if (z <= 0) continue;
				ctx.fillStyle = `rgba(230, 255, 245, ${(0.4 + 0.6 * z) * pulse})`;
				ctx.beginPath();
				ctx.arc(x * r, -y * r, 1.2 + 1.8 * z, 0, TAU);
				ctx.fill();
			}
		}
	}

	// полюси
	for (const sign of [1, -1]) {
		const [x, y, z] = spherePoint(sign * (Math.PI / 2), 0);
		if (z < -0.05) continue;
		ctx.fillStyle = `rgba(230, 255, 245, ${0.9 * pulse})`;
		ctx.beginPath();
		ctx.arc(x * r, -y * r, 3, 0, TAU);
		ctx.fill();
	}

	// контур
	ctx.strokeStyle = `rgba(130, 220, 190, ${0.3 * pulse})`;
	ctx.lineWidth = 8;
	ctx.beginPath();
	ctx.arc(0, 0, r, 0, TAU);
	ctx.stroke();
	ctx.strokeStyle = `rgba(160, 240, 210, ${0.85 * pulse})`;
	ctx.lineWidth = 2.5;
	ctx.stroke();

	// відблиск
	ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
	ctx.lineWidth = 3.5;
	ctx.beginPath();
	ctx.arc(0, 0, r * 0.9, Math.PI * 1.08, Math.PI * 1.34);
	ctx.stroke();

	ctx.restore();
}
