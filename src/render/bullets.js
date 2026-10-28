const TAU = Math.PI * 2;

// серце з центром (0, 0), s — масштаб (ширина ≈ 1.8·s, висота ≈ 1.25·s)
function heartPath(ctx, s) {
	ctx.beginPath();
	ctx.moveTo(0, 0.9 * s);
	ctx.bezierCurveTo(-1.3 * s, 0.1 * s, -0.9 * s, -0.9 * s, 0, -0.35 * s);
	ctx.bezierCurveTo(0.9 * s, -0.9 * s, 1.3 * s, 0.1 * s, 0, 0.9 * s);
	ctx.closePath();
}

// куля-серденько: рожеве серце з хвостом із маленьких сердечок проти польоту
export function drawBullet(ctx, b, x, y) {
	// ttl зменшується з часом, тож дає і пульсацію, і погойдування без нового стану
	const beat = 1 + 0.08 * Math.sin(b.ttl * 24);
	const tilt = Math.sin(b.ttl * 12) * 0.18;
	const S = 12 * beat;

	ctx.save();
	ctx.lineJoin = "round";

	// хвіст: три сердечка, що зменшуються й тануть
	for (let i = 3; i >= 1; i--) {
		const k = i * 0.028;
		ctx.save();
		ctx.translate(x - b.vel.x * k, y - b.vel.y * k);
		ctx.globalAlpha = 0.5 - i * 0.12;
		heartPath(ctx, S * (0.62 - i * 0.12));
		ctx.fillStyle = "#ffb3d9";
		ctx.fill();
		ctx.restore();
	}

	ctx.translate(x, y);
	ctx.rotate(tilt);

	// світіння
	heartPath(ctx, S);
	ctx.strokeStyle = "rgba(255, 179, 217, 0.4)";
	ctx.lineWidth = 9;
	ctx.stroke();

	// тіло
	const g = ctx.createRadialGradient(-S * 0.35, -S * 0.45, 1, 0, 0, S * 1.3);
	g.addColorStop(0, "#fff0f7");
	g.addColorStop(0.45, "#ffa6cf");
	g.addColorStop(1, "#ee6fa8");
	heartPath(ctx, S);
	ctx.fillStyle = g;
	ctx.fill();
	ctx.strokeStyle = "#e0609b";
	ctx.lineWidth = 1.6;
	ctx.stroke();

	// відблиск на лівій «частці»
	ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
	ctx.beginPath();
	ctx.ellipse(-S * 0.5, -S * 0.38, S * 0.22, S * 0.13, -0.6, 0, TAU);
	ctx.fill();

	ctx.restore();
}