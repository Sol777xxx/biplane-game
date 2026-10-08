export const CLOUDS = [
	{ x: 250, y: 160, s: 1.2 },
	{ x: 900, y: 110, s: 1.6 },
	{ x: 1350, y: 300, s: 1 },
	{ x: 500, y: 650, s: 1.4 },
	{ x: 1150, y: 740, s: 1.1 },
];

export function drawCloud(ctx, { x, y, s }) {
	ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
	ctx.beginPath();
	ctx.arc(x, y, 38 * s, 0, Math.PI * 2);
	ctx.arc(x + 45 * s, y + 8 * s, 30 * s, 0, Math.PI * 2);
	ctx.arc(x - 45 * s, y + 10 * s, 28 * s, 0, Math.PI * 2);
	ctx.arc(x + 15 * s, y - 22 * s, 28 * s, 0, Math.PI * 2);
	ctx.fill();
}
