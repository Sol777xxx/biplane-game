import type { Ctx } from "./canvas.ts";

const TAU = Math.PI * 2;

// півосі щита: витягнутий горизонтально, приплюснутий по вертикалі
export const SHIELD_RX = 124;
export const SHIELD_RY = 88;

const MERIDIANS = 8;
const LATITUDES: readonly number[] = [-60, -30, 0, 30, 60].map(
	(deg) => (deg * Math.PI) / 180,
); // радіани
const TILT = 0.45;
const SEG = 56;
const COS_TILT = Math.cos(TILT);
const SIN_TILT = Math.sin(TILT);

// Щит малюється щокадру для кожного корабля зі щитом. Раніше кожна точка сфери була масивом
// [x, y, z], а кожна лінія окремим Path2D: сотні об'єктів на щит за кадр. Тепер геометрія
// пишеться у попередньо виділені Float64Array і відтворюється в шлях контексту: нуль алокацій.

// Набір відрізків (x1, y1, x2, y2 підряд) у фіксованому буфері.
interface Segments {
	readonly buf: Float64Array;
	n: number;
}
const segments = (count: number): Segments => ({
	buf: new Float64Array(count * 4),
	n: 0,
});

const WIRE = MERIDIANS * SEG + LATITUDES.length * SEG;
const front = segments(WIRE);
const back = segments(WIRE);
const scanFront = segments(SEG);
const scanBack = segments(SEG); // задня половина кільця не малюється, буфер лише приймає її

// остання обчислена точка сфери: [x, y, z]
const P = new Float64Array(3);

// точка сфери (широта, довгота) з нахилом навколо осі X
function spherePoint(phi: number, theta: number): void {
	const cp = Math.cos(phi);
	const x = cp * Math.sin(theta);
	const y = Math.sin(phi);
	const z = cp * Math.cos(theta);
	P[0] = x;
	P[1] = y * COS_TILT - z * SIN_TILT;
	P[2] = y * SIN_TILT + z * COS_TILT;
}

// Крива сфери: меридіан (змінюється широта) або паралель (змінюється довгота).
// Кожен відрізок іде в front чи back залежно від глибини.
function curve(
	meridian: boolean,
	fixed: number,
	r: number,
	toFront: Segments,
	toBack: Segments,
): void {
	let x1 = 0;
	let y1 = 0;
	let z1 = 0;
	for (let i = 0; i <= SEG; i++) {
		const t = (i / SEG) * TAU;
		if (meridian) spherePoint(t, fixed);
		else spherePoint(fixed, t);
		const x2 = P[0] ?? 0;
		const y2 = P[1] ?? 0;
		const z2 = P[2] ?? 0;
		if (i > 0) {
			const out = z1 + z2 >= 0 ? toFront : toBack;
			const k = out.n;
			out.buf[k] = x1 * r;
			out.buf[k + 1] = -y1 * r;
			out.buf[k + 2] = x2 * r;
			out.buf[k + 3] = -y2 * r;
			out.n = k + 4;
		}
		x1 = x2;
		y1 = y2;
		z1 = z2;
	}
}

// відрізки в шлях контексту (Path2D більше не потрібен)
function trace(ctx: Ctx, s: Segments): void {
	ctx.beginPath();
	for (let i = 0; i < s.n; i += 4) {
		ctx.moveTo(s.buf[i] ?? 0, s.buf[i + 1] ?? 0);
		ctx.lineTo(s.buf[i + 2] ?? 0, s.buf[i + 3] ?? 0);
	}
}

// Колір задається один раз, прозорість через globalAlpha: інакше кожен кадр створював би
// десятки рядків rgba(...), а раніше ще й новий градієнт зі стопами.
const GLASS = { r: 130, g: 220, b: 190 };
let glassGradient: { ctx: Ctx; gradient: CanvasGradient } | null = null;

function glass(ctx: Ctx, r: number): CanvasGradient {
	if (glassGradient?.ctx === ctx) return glassGradient.gradient;
	const g = ctx.createRadialGradient(0, 0, r * 0.5, 0, 0, r);
	g.addColorStop(0, `rgba(${GLASS.r}, ${GLASS.g}, ${GLASS.b}, 0)`);
	g.addColorStop(0.75, `rgba(${GLASS.r}, ${GLASS.g}, ${GLASS.b}, 0.08)`);
	g.addColorStop(1, "rgba(170, 245, 215, 0.3)");
	glassGradient = { ctx, gradient: g };
	return g;
}

// remaining: секунд до кінця щита (наприкінці блимає)
export function drawShield(
	ctx: Ctx,
	cx: number,
	cy: number,
	rx: number,
	ry: number,
	time: number,
	remaining: number,
): void {
	if (remaining < 1.5 && Math.floor(time / 100) % 2 === 0) return;

	const r = rx; // рахуємо для кола, потім розтягуємо в еліпс
	const pulse = 0.85 + 0.15 * Math.sin(time * 0.004);
	const spin = time * 0.0007;

	ctx.save();
	ctx.translate(cx, cy);
	ctx.scale(1, ry / rx);
	ctx.lineCap = "round";
	ctx.lineJoin = "round";

	// скляна поверхня: градієнт один на контекст, пульсація через globalAlpha
	ctx.globalAlpha = pulse;
	ctx.fillStyle = glass(ctx, r);
	ctx.beginPath();
	ctx.arc(0, 0, r, 0, TAU);
	ctx.fill();

	front.n = 0;
	back.n = 0;
	for (let m = 0; m < MERIDIANS; m++) {
		curve(true, spin + (m * Math.PI) / MERIDIANS, r, front, back);
	}
	for (let i = 0; i < LATITUDES.length; i++) {
		curve(false, LATITUDES[i] ?? 0, r, front, back);
	}

	// задня половина
	trace(ctx, back);
	ctx.strokeStyle = "rgb(95, 184, 154)";
	ctx.globalAlpha = 0.3 * pulse;
	ctx.lineWidth = 1.1;
	ctx.stroke();

	// передня половина: шлях той самий, двічі різним штрихом
	trace(ctx, front);
	ctx.strokeStyle = "rgb(130, 220, 190)";
	ctx.globalAlpha = 0.28 * pulse;
	ctx.lineWidth = 5;
	ctx.stroke();
	ctx.strokeStyle = "rgb(200, 255, 235)";
	ctx.globalAlpha = 0.9 * pulse;
	ctx.lineWidth = 1.5;
	ctx.stroke();

	// сканувальне кільце
	scanFront.n = 0;
	scanBack.n = 0;
	curve(false, Math.sin(time * 0.0012) * 1.1, r, scanFront, scanBack);
	trace(ctx, scanFront);
	ctx.strokeStyle = "rgb(210, 255, 240)";
	ctx.globalAlpha = 0.35 * pulse;
	ctx.lineWidth = 6;
	ctx.stroke();
	ctx.strokeStyle = "rgb(255, 255, 255)";
	ctx.globalAlpha = 0.9 * pulse;
	ctx.lineWidth = 1.8;
	ctx.stroke();

	// вузли
	ctx.fillStyle = "rgb(230, 255, 245)";
	for (let m = 0; m < MERIDIANS; m++) {
		const theta = spin + (m * Math.PI) / MERIDIANS;
		for (let side = 0; side < 2; side++) {
			for (let i = 0; i < LATITUDES.length; i++) {
				spherePoint(LATITUDES[i] ?? 0, theta + side * Math.PI);
				const z = P[2] ?? 0;
				if (z <= 0) continue;
				ctx.globalAlpha = (0.4 + 0.6 * z) * pulse;
				ctx.beginPath();
				ctx.arc((P[0] ?? 0) * r, -(P[1] ?? 0) * r, 1.2 + 1.8 * z, 0, TAU);
				ctx.fill();
			}
		}
	}

	// полюси
	ctx.globalAlpha = 0.9 * pulse;
	for (let k = 0; k < 2; k++) {
		spherePoint((k === 0 ? 1 : -1) * (Math.PI / 2), 0);
		if ((P[2] ?? 0) < -0.05) continue;
		ctx.beginPath();
		ctx.arc((P[0] ?? 0) * r, -(P[1] ?? 0) * r, 3, 0, TAU);
		ctx.fill();
	}

	// контур
	ctx.strokeStyle = "rgb(130, 220, 190)";
	ctx.globalAlpha = 0.3 * pulse;
	ctx.lineWidth = 8;
	ctx.beginPath();
	ctx.arc(0, 0, r, 0, TAU);
	ctx.stroke();
	ctx.strokeStyle = "rgb(160, 240, 210)";
	ctx.globalAlpha = 0.85 * pulse;
	ctx.lineWidth = 2.5;
	ctx.stroke();

	// відблиск
	ctx.strokeStyle = "rgb(255, 255, 255)";
	ctx.globalAlpha = 0.6;
	ctx.lineWidth = 3.5;
	ctx.beginPath();
	ctx.arc(0, 0, r * 0.9, Math.PI * 1.08, Math.PI * 1.34);
	ctx.stroke();

	ctx.restore(); // повертає і globalAlpha
}
