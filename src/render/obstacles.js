const TAU = Math.PI * 2;

// Візуальний розмір хмарки відносно хітбокса
const VISUAL_SCALE = 1.3;

// Основні пухкі форми: [dx, dy, r] у частках радіуса
const PUFFS = [
	[-0.05, 0.0, 0.52],
	[-0.55, 0.1, 0.4],
	[0.45, 0.08, 0.44],
	[-0.3, -0.3, 0.38],
	[0.12, -0.36, 0.42],
	[0.62, -0.2, 0.3],
	[-0.92, 0.17, 0.28],
	[0.98, 0.15, 0.3],
	[0.1, 0.24, 0.42],
	[-0.4, 0.28, 0.32],
].map(([dx, dy, k]) => [dx - 0.1, dy, k]);

const C = {
	// Сірі грозові кольори
	outline: "rgba(120, 106, 170, 0.45)",
	top: "#ebe7f8",
	middle: "#c9c2e2",
	bottom: "#9d95bf",
	shadowRgb: "92, 78, 146",
	lightRgb: "246, 240, 255",

	// Яскраві кольори спалахів
	haloRgb: "90, 160, 255",
	glowRgb: "170, 215, 255",
	flashRgb: "235, 245, 255",
	threadOuter: "rgba(80, 140, 255, 0.55)",
	threadGlow: "rgba(130, 195, 255, 0.9)",
	threadCore: "#ffffff",
};

// Інтервали виникнення блискавок
const CHANNELS = [
	[520, 0],
	[690, 211],
	[850, 433],
];

const STRIKE_MS = 320;

// Сила спалаху: більшість розрядів слабкі, потужні трапляються рідко
const BIG_CHANCE = 0.15;
const SMALL_POWER = 0.3;

// Стабільне псевдовипадкове число
function hash(n) {
	const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
	return x - Math.floor(x);
}

function makeRng(seed) {
	let s = (Math.floor(Math.abs(seed)) % 2147483646) + 1;

	return () => {
		s = (s * 16807) % 2147483647;
		return s / 2147483647;
	};
}

// Визначення моменту спалаху
function strikeAt(time, id, k) {
	const [slot, off] = CHANNELS[k];
	const tt = time + id * 531 + off;
	const n = Math.floor(tt / slot);

	if (hash(n * 3.1 + k * 17.7 + id) > 0.55) {
		return null;
	}

	const t = tt - n * slot;

	if (t > STRIKE_MS) {
		return null;
	}

	const e = (1 - t / STRIKE_MS) * (0.55 + 0.45 * Math.abs(Math.sin(t * 0.05)));

	const seed = n * 131 + k * 977 + Math.abs(id) * 7919;
	const power = hash(seed * 0.37 + 5.3) < BIG_CHANCE ? 1 : SMALL_POWER;

	return {
		e,
		power,
		seed,
	};
}

// Геометрія основної блискавки та її відгалужень
function strikeGeometry(seed, r) {
	const rnd = makeRng(seed);

	const a0 = rnd() * TAU;
	const d0 = rnd() * 0.5;

	const x0 = Math.cos(a0) * d0 * r;
	const y0 = Math.sin(a0) * d0 * r * 0.6;

	const a1 = rnd() * TAU;
	const x1 = Math.cos(a1) * 1.1 * r;
	const y1 = Math.sin(a1) * 0.5 * r + 0.05 * r;

	const N = 9;
	const dx = x1 - x0;
	const dy = y1 - y0;
	const len = Math.hypot(dx, dy) || 1;

	const px = -dy / len;
	const py = dx / len;

	const main = [];

	for (let i = 0; i <= N; i++) {
		const u = i / N;
		const j = (rnd() - 0.5) * 0.24 * r * Math.sin(Math.PI * u);

		main.push([x0 + dx * u + px * j, y0 + dy * u + py * j]);
	}

	const branches = [];
	const nb = 1 + Math.floor(rnd() * 2);

	for (let b = 0; b < nb; b++) {
		const index = 2 + Math.floor(rnd() * (N - 3));
		const [sx, sy] = main[index];

		let ang = Math.atan2(dy, dx) + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.5);

		const branch = [[sx, sy]];
		let cx = sx;
		let cy = sy;

		for (let i = 0; i < 3; i++) {
			ang += (rnd() - 0.5) * 1.1;

			cx += Math.cos(ang) * 0.1 * r;
			cy += Math.sin(ang) * 0.1 * r;

			branch.push([cx, cy]);
		}

		branches.push(branch);
	}

	return {
		main,
		branches,
		mid: main[Math.floor(N / 2)],
	};
}

// Єдиний шлях силуету з великих пухких форм
function puffPath(ctx, r, mul = 1, ox = 0, oy = 0) {
	ctx.beginPath();

	for (const [dx, dy, k] of PUFFS) {
		const rad = k * r * mul;
		const x = dx * r + ox * r;
		const y = dy * r + oy * r;

		ctx.moveTo(x + rad, y);
		ctx.arc(x, y, rad, 0, TAU);
	}
}

// Малювання лінії блискавки
function strokeLine(ctx, pts) {
	ctx.beginPath();

	pts.forEach(([x, y], i) => {
		if (i === 0) {
			ctx.moveTo(x, y);
		} else {
			ctx.lineTo(x, y);
		}
	});

	ctx.stroke();
}

// Створення статичного тіла хмари
const HALF = 1.8;
const bodyCache = new Map();

// Внутрішня тін    : заливаємо все кольором, потім вирізаємо розмитий
// зсунутий силует (тінь малюється через зсув, самого силуету на полотні немає)
function insetShade(r, color, ox, oy, blur) {
	const px = Math.ceil(2 * HALF * r);
	const FAR = px * 4;

	const t = document.createElement("canvas");
	t.width = t.height = px;

	const tg = t.getContext("2d");
	tg.translate(px / 2, px / 2);

	tg.fillStyle = color;
	tg.fillRect(-px, -px, 2 * px, 2 * px);

	tg.globalCompositeOperation = "destination-out";
	tg.shadowColor = "#000";
	tg.shadowBlur = r * blur;
	tg.shadowOffsetX = ox * r - FAR;
	tg.shadowOffsetY = oy * r;
	tg.fillStyle = "#000";

	puffPath(tg, r, 1, FAR / r, 0);
	tg.fill();

	return t;
}

function paintBody(g, r) {
	// 1. Темний край силуету
	g.save();

	g.lineJoin = "round";
	g.lineWidth = Math.max(1, r * 0.024);
	g.strokeStyle = C.outline;

	puffPath(g, r);
	g.stroke();

	// Все далі малюється всередині силуету
	g.save();

	puffPath(g, r);
	g.clip();

	const full = [-HALF * r, -HALF * r, 2 * HALF * r, 2 * HALF * r];

	// 2. Базова сіра заливка
	const base = g.createLinearGradient(0, -0.7 * r, 0, 0.75 * r);

	base.addColorStop(0, C.top);
	base.addColorStop(0.5, C.middle);
	base.addColorStop(1, C.bottom);

	g.fillStyle = base;
	g.fillRect(...full);

	// 3. М'який внутрішній об'єм від ЗЛИТОГО силуету (без контурів окремих форм):
	//    тінь знизу-праворуч і світло зверху-ліворуч
	g.drawImage(
		insetShade(r, `rgba(${C.shadowRgb}, 0.3)`, -0.05, -0.13, 0.34),
		-HALF * r,
		-HALF * r,
	);

	g.drawImage(
		insetShade(r, `rgba(${C.lightRgb}, 0.55)`, 0.06, 0.1, 0.26),
		-HALF * r,
		-HALF * r,
	);

	// 5. Дуже м'яка текстура: розмиті світлі й темні плями
	const rnd = makeRng(Math.round(r * 13) + 7);

	for (let i = 0; i < 26; i++) {
		const a = rnd() * TAU;
		const d = Math.sqrt(rnd()) * 0.8;

		const x = Math.cos(a) * d * r;
		const y = Math.sin(a) * d * r * 0.4;
		const rad = (0.14 + rnd() * 0.16) * r;

		rnd();
		const rgb = C.lightRgb;
		const alpha = 0.1;

		const spot = g.createRadialGradient(x, y, 0, x, y, rad);

		spot.addColorStop(0, `rgba(${rgb}, ${alpha})`);
		spot.addColorStop(1, `rgba(${rgb}, 0)`);

		g.fillStyle = spot;
		g.fillRect(x - rad, y - rad, 2 * rad, 2 * rad);
	}

	// 6. Важке темне черево хмари
	const belly = g.createLinearGradient(0, 0, 0, 0.75 * r);

	belly.addColorStop(0, `rgba(${C.shadowRgb}, 0)`);
	belly.addColorStop(1, `rgba(${C.shadowRgb}, 0.18)`);

	g.fillStyle = belly;
	g.fillRect(...full);

	// 7. Приглушений відблиск зверху
	const shine = g.createRadialGradient(
		-0.22 * r,
		-0.4 * r,
		0,
		-0.22 * r,
		-0.4 * r,
		0.8 * r,
	);

	shine.addColorStop(0, "rgba(240, 244, 255, 0.55)");
	shine.addColorStop(0.55, "rgba(240, 244, 255, 0.16)");
	shine.addColorStop(1, "rgba(240, 244, 255, 0)");

	g.fillStyle = shine;
	g.fillRect(...full);

	g.restore();
	g.restore();
}

// Кешування готового тіла, щоб не перемальовувати його щокадру
function getBody(r, scale) {
	const key = Math.max(8, Math.round(r * scale));

	let c = bodyCache.get(key);

	if (!c) {
		if (bodyCache.size > 48) {
			bodyCache.clear();
		}

		const px = Math.ceil(2 * HALF * key);

		c = document.createElement("canvas");
		c.width = c.height = px;

		const g = c.getContext("2d");
		g.translate(px / 2, px / 2);

		paintBody(g, key);

		bodyCache.set(key, c);
	}

	return c;
}

// Малювання грозової хмарки
export function drawObstacle(ctx, o, x, y, time) {
	const r = o.radius * VISUAL_SCALE;

	const bob = Math.sin(time * 0.002 + o.id) * r * 0.05;

	const strikes = [];
	let lit = 0;

	for (let k = 0; k < CHANNELS.length; k++) {
		const s = strikeAt(time, o.id, k);

		if (!s) {
			continue;
		}

		s.geo = strikeGeometry(s.seed, r);
		strikes.push(s);

		lit = Math.max(lit, s.e * s.power);
	}

	const breathe = 0.5 + 0.5 * Math.sin(time * 0.0025 + o.id * 2);

	ctx.save();
	ctx.translate(x, y + bob);

	// 1. Яскравий блакитний ореол під час розряду
	if (lit > 0.02) {
		const halo = ctx.createRadialGradient(
			0,
			0.05 * r,
			r * 0.4,
			0,
			0.05 * r,
			r * 2.4,
		);

		halo.addColorStop(0, `rgba(${C.haloRgb}, ${0.6 * lit})`);

		halo.addColorStop(0.5, `rgba(${C.haloRgb}, ${0.2 * lit})`);

		halo.addColorStop(1, `rgba(${C.haloRgb}, 0)`);

		ctx.fillStyle = halo;
		ctx.beginPath();
		ctx.arc(0, 0.05 * r, r * 2.4, 0, TAU);
		ctx.fill();
	}

	// 2. Основне сіре тіло
	const scale = ctx.getTransform().a || 1;

	ctx.drawImage(
		getBody(r, scale),
		-HALF * r,
		-HALF * r,
		2 * HALF * r,
		2 * HALF * r,
	);

	// 3. Внутрішнє світіння
	ctx.save();

	puffPath(ctx, r);
	ctx.clip();

	ctx.globalCompositeOperation = "lighter";

	const full = [-HALF * r, -HALF * r, 2 * HALF * r, 2 * HALF * r];

	const idle = ctx.createRadialGradient(0, 0.25 * r, 0, 0, 0.25 * r, 1.1 * r);

	idle.addColorStop(0, `rgba(160, 140, 255, ${0.05 + 0.04 * breathe})`);

	idle.addColorStop(1, "rgba(160, 140, 255, 0)");

	ctx.fillStyle = idle;
	ctx.fillRect(...full);

	if (lit > 0.01) {
		// Вся хмара підсвічується зсередини
		const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1.35 * r);

		glow.addColorStop(0, `rgba(${C.glowRgb}, ${0.5 * lit})`);

		glow.addColorStop(0.6, `rgba(${C.haloRgb}, ${0.3 * lit})`);

		glow.addColorStop(1, `rgba(${C.haloRgb}, 0)`);

		ctx.fillStyle = glow;
		ctx.fillRect(...full);
	}

	// Локальний яскравий спалах у місцях розрядів
	for (const s of strikes) {
		const [mx, my] = s.geo.mid;

		const glow = ctx.createRadialGradient(mx, my, 0, mx, my, 0.9 * r);

		glow.addColorStop(0, `rgba(${C.flashRgb}, ${1.0 * s.e * s.power})`);

		glow.addColorStop(0.4, `rgba(${C.glowRgb}, ${0.55 * s.e * s.power})`);

		glow.addColorStop(1, `rgba(${C.haloRgb}, 0)`);

		ctx.fillStyle = glow;
		ctx.fillRect(mx - 0.9 * r, my - 0.9 * r, 1.8 * r, 1.8 * r);
	}

	ctx.restore();

	// 4. Блискавки поверх хмари (адитивне змішування для яскравості)
	ctx.save();

	ctx.globalCompositeOperation = "lighter";
	ctx.lineJoin = "round";
	ctx.lineCap = "round";

	for (const s of strikes) {
		ctx.globalAlpha = Math.min(1, s.e * 1.5 * (0.55 + 0.45 * s.power));

		const lines = [s.geo.main, ...s.geo.branches];

		// Широке зовнішнє світіння
		ctx.strokeStyle = C.threadOuter;
		ctx.lineWidth = Math.max(2.4, r * 0.05);

		for (const line of lines) {
			strokeLine(ctx, line);
		}

		// Середнє яскраве світіння
		ctx.strokeStyle = C.threadGlow;
		ctx.lineWidth = Math.max(0.7, r * 0.01);

		for (const line of lines) {
			strokeLine(ctx, line);
		}

		// Біла серцевина
		ctx.strokeStyle = C.threadCore;
		ctx.lineWidth = Math.max(1.2, r * 0.022);

		strokeLine(ctx, s.geo.main);

		ctx.lineWidth = Math.max(0.6, r * 0.007);

		for (const branch of s.geo.branches) {
			strokeLine(ctx, branch);
		}

		// Яскраві точки на кінцях
		for (const [px, py] of [s.geo.main[0], s.geo.main[s.geo.main.length - 1]]) {
			const pr = Math.max(1.5, r * 0.035);

			const dot = ctx.createRadialGradient(px, py, 0, px, py, pr);

			dot.addColorStop(0, "rgba(255, 255, 255, 1)");
			dot.addColorStop(0.4, "rgba(170, 215, 255, 0.8)");
			dot.addColorStop(1, "rgba(90, 160, 255, 0)");

			ctx.fillStyle = dot;
			ctx.beginPath();
			ctx.arc(px, py, pr, 0, TAU);
			ctx.fill();
		}
	}

	ctx.restore();
	ctx.restore();
}
