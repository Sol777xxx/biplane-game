const TAU = Math.PI * 2;

const COLORS = {
	pink: { core: "255, 179, 217", edge: "247, 168, 207" },
	storm: { core: "201, 194, 226", edge: "157, 149, 191" },
};

const PICKUPS = {
	shield: { color: "#82dcbe", label: "S" },
	rapid: { color: "#ffd27a", label: "R" },
	homing: { color: "#b79fe8", label: "H" },
};

// частинка: p.life 1 → 0
export function drawParticle(ctx, p, x, y) {
	const c = COLORS[p.color] ?? COLORS.pink;
	ctx.fillStyle = `rgba(${c.core}, ${p.life})`;
	ctx.beginPath();
	ctx.arc(x, y, 2 + 4 * p.life, 0, TAU);
	ctx.fill();
}

// вибух: спалах + кільце, що розширюється
export function drawExplosion(ctx, e, x, y) {
	const c = COLORS[e.color] ?? COLORS.pink;
	const t = 1 - e.life;
	const r = e.size * (0.4 + 0.9 * t);

	const g = ctx.createRadialGradient(x, y, 0, x, y, r);
	g.addColorStop(0, `rgba(255, 255, 255, ${0.9 * e.life})`);
	g.addColorStop(0.5, `rgba(${c.core}, ${0.5 * e.life})`);
	g.addColorStop(1, `rgba(${c.edge}, 0)`);
	ctx.fillStyle = g;
	ctx.beginPath();
	ctx.arc(x, y, r, 0, TAU);
	ctx.fill();

	ctx.strokeStyle = `rgba(${c.edge}, ${e.life})`;
	ctx.lineWidth = 4 * e.life + 1;
	ctx.beginPath();
	ctx.arc(x, y, r * 0.9, 0, TAU);
	ctx.stroke();
}
// зірка з n променями; outer — радіус кінчиків, inner — радіус западин
function starPath(ctx, x, y, outer, inner, n = 5, rot = -Math.PI / 2) {
	ctx.beginPath();
	for (let i = 0; i < n * 2; i++) {
		const r = i % 2 === 0 ? outer : inner;
		const a = rot + (i * Math.PI) / n;
		const px = x + Math.cos(a) * r;
		const py = y + Math.sin(a) * r;
		if (i === 0) ctx.moveTo(px, py);
		else ctx.lineTo(px, py);
	}
	ctx.closePath();
}
// pickup: зірка з літерою, блимає перед зникненням
export function drawPickup(ctx, e, x, y, time) {
	if (e.life < 0.25 && Math.floor(time / 120) % 2 === 0) return;
	const s = PICKUPS[e.type] ?? PICKUPS.shield;
	const cy = y + Math.sin(time * 0.004) * 4;
	const spin = Math.sin(time * 0.003) * 0.12; // легке погойдування
	const R = e.radius; // кінчики впритик до хітбокса

	ctx.save();
	ctx.lineJoin = "round";

	// світіння
	starPath(ctx, x, cy, R, R * 0.5, 5, -Math.PI / 2 + spin);
	ctx.strokeStyle = s.color;
	ctx.globalAlpha = 0.35;
	ctx.lineWidth = 10;
	ctx.stroke();
	ctx.globalAlpha = 1;

	// тіло зірки
	ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
	ctx.strokeStyle = s.color;
	ctx.lineWidth = 4;
	starPath(ctx, x, cy, R, R * 0.5, 5, -Math.PI / 2 + spin);
	ctx.fill();
	ctx.stroke();

	// літера
	ctx.fillStyle = s.color;
	ctx.font = "bold 22px ui-monospace, Consolas, monospace";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(s.label, x, cy + 3);

	ctx.restore();
}
