const TAU = Math.PI * 2;

// куля: рожеве ядро з хвостом проти напрямку польоту
export function drawBullet(ctx, b, x, y) {
	// хвіст
	ctx.strokeStyle = "rgba(255, 179, 217, 0.45)";
	ctx.lineWidth = 12;
	ctx.lineCap = "round";
	ctx.beginPath();
	ctx.moveTo(x, y);
	ctx.lineTo(x - b.vel.x * 0.04, y - b.vel.y * 0.04);
	ctx.stroke();

	// ядро
	const g = ctx.createRadialGradient(x - 2, y - 2, 1, x, y, 11);
	g.addColorStop(0, "#ffffff");
	g.addColorStop(1, "#ffb3d9");
	ctx.fillStyle = g;
	ctx.beginPath();
	ctx.arc(x, y, 10, 0, TAU);
	ctx.fill();
}
