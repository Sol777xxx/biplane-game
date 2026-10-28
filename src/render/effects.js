const TAU = Math.PI * 2;
const RGB = { pink: "255, 150, 200", storm: "140, 170, 255" };

export function drawParticle(ctx, p, x, y) {
	ctx.fillStyle = `rgba(${RGB[p.color] ?? RGB.pink}, ${p.life})`;
	ctx.beginPath();
	ctx.arc(x, y, 2 + 5 * p.life, 0, TAU);
	ctx.fill();
}

export function drawExplosion(ctx, e, x, y) {
	const t = 1 - e.life;
	ctx.fillStyle = `rgba(255, 255, 255, ${0.6 * e.life})`;
	ctx.beginPath();
	ctx.arc(x, y, e.size * 0.5 * (0.4 + t), 0, TAU);
	ctx.fill();
	ctx.strokeStyle = `rgba(${RGB[e.color] ?? RGB.pink}, ${e.life})`;
	ctx.lineWidth = 2 + 8 * e.life;
	ctx.beginPath();
	ctx.arc(x, y, e.size * (0.3 + 0.7 * t), 0, TAU);
	ctx.stroke();
}

const PICKUP_STYLE = {
	shield: { color: "#a8e6cf", icon: "🛡" },
	rapid: { color: "#ffe27a", icon: "⚡" },
	homing: { color: "#f7a8cf", icon: "🎯" },
};

export function drawPickup(ctx, p, x, y, time) {
	const { color, icon } = PICKUP_STYLE[p.type];
	const r = p.radius * (1 + 0.08 * Math.sin(time * 0.006));
	ctx.save();
	// мигає наприкінці життя
	if (p.life < 0.25 && Math.floor(time / 150) % 2) ctx.globalAlpha = 0.35;
	const g = ctx.createRadialGradient(x - 6, y - 6, 2, x, y, r);
	g.addColorStop(0, "#ffffff");
	g.addColorStop(1, color);
	ctx.fillStyle = g;
	ctx.strokeStyle = "#8f78c4";
	ctx.lineWidth = 3;
	ctx.beginPath();
	ctx.arc(x, y, r, 0, TAU);
	ctx.fill();
	ctx.stroke();
	ctx.font = `${Math.round(r)}px sans-serif`;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(icon, x, y + 2);
	ctx.restore();
}