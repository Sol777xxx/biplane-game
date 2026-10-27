export const CLOUDS = [
	{ x: 250, y: 160, s: 1.2 },
	{ x: 900, y: 110, s: 1.6 },
	{ x: 1350, y: 300, s: 1 },
	{ x: 500, y: 650, s: 1.4 },
	{ x: 1150, y: 740, s: 1.1 },
];

// Бульбашки хмарки в локальних координатах (центр = 0,0): [cx, cy, r]
const PUFFS = [
	[-28, -26, 52],
	[46, -14, 42],
	[100, 10, 25],
	[-98, 12, 30],
	[-70, 34, 31],
	[-18, 38, 36],
	[34, 38, 35],
	[76, 31, 30],
	[0, 16, 42], // тіло: лишає помірні западини між нижніми частинами
	[-2, 8, 48],
	[-88, -8, 22],
];

// Палітра під стиль сайту: пастельний лавандово-рожевий
const OUTLINE = "rgba(228, 230, 244, 0.45)"; // ледь помітна обводка
const RIM = "rgba(240, 240, 250, 1)"; // майже білий лавандовий край
const RIM_PINK = "rgba(248, 240, 248, 1)"; // ледь рожевий відтінок
const SPRITE_W = 300;
const SPRITE_H = 200;
const QUALITY = 2;

let sprite = null;

function puffPath(ctx) {
	ctx.beginPath();
	for (const [cx, cy, r] of PUFFS) {
		ctx.moveTo(cx + r, cy);
		ctx.arc(cx, cy, r, 0, Math.PI * 2);
	}
}

function buildSprite() {
	const c = document.createElement("canvas");
	c.width = SPRITE_W * QUALITY;
	c.height = SPRITE_H * QUALITY;
	const g = c.getContext("2d");
	g.scale(QUALITY, QUALITY);
	g.translate(SPRITE_W / 2, SPRITE_H / 2);

	// 1) тонкий м'який контур по зовнішньому силуету
	g.lineJoin = "round";
	g.strokeStyle = OUTLINE;
	g.lineWidth = 3;
	puffPath(g);
	g.stroke();

	// 2) заливка і затінення — тільки всередині силуету, БЕЗ окремих кіл
	g.save();
	puffPath(g);
	g.clip();

	// база: лавандово-рожевий градієнт, який потім майже весь перекриється білим
	const base = g.createLinearGradient(0, -80, 0, 70);
	base.addColorStop(0, RIM);
	base.addColorStop(1, RIM_PINK);
	g.fillStyle = base;
	g.fillRect(-SPRITE_W / 2, -SPRITE_H / 2, SPRITE_W, SPRITE_H);

	// єдиний розмитий білий силует, зсунутий вгору: лишає плавний
	// лавандовий край знизу й по боках уздовж усієї форми
	g.save();
	if ("filter" in g) g.filter = "blur(7px)";
	g.translate(0, -10);
	g.scale(0.975, 0.955);
	g.fillStyle = "#fff";
	puffPath(g);
	g.fill();
	g.restore();

	// один великий м'який відблиск зверху
	g.save();
	if ("filter" in g) g.filter = "blur(10px)";
	g.fillStyle = "rgba(255,255,255,0.9)";
	g.beginPath();
	g.ellipse(-24, -40, 34, 18, -0.25, 0, Math.PI * 2);
	g.fill();
	g.restore();

	g.restore();
	return c;
}

export function drawCloud(ctx, { x, y, s }, alpha = 0.7) {
	if (!sprite) sprite = buildSprite();
	ctx.save();
	ctx.globalAlpha = alpha;
	ctx.drawImage(
		sprite,
		x - (SPRITE_W / 2) * s,
		y - (SPRITE_H / 2) * s,
		SPRITE_W * s,
		SPRITE_H * s
	);
	ctx.restore();
}