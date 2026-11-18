import type { Ctx } from "../canvas.ts";

// авіаційні окуляри; (x, y) це центр лінзи
export function drawGoggles(ctx: Ctx, x: number, y: number): void {
	// ремінець
	ctx.strokeStyle = "#7d68b0";
	ctx.lineWidth = 1.6;
	ctx.beginPath();
	ctx.moveTo(x - 9, y);
	ctx.lineTo(x - 2, y);
	ctx.stroke();

	// лінза
	ctx.fillStyle = "#cfe8ff";
	ctx.strokeStyle = "#7d68b0";
	ctx.lineWidth = 1.4;
	ctx.beginPath();
	ctx.arc(x, y, 3.2, 0, Math.PI * 2);
	ctx.fill();
	ctx.stroke();

	// відблиск
	ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
	ctx.beginPath();
	ctx.arc(x - 1, y - 1, 0.9, 0, Math.PI * 2);
	ctx.fill();
}

// шарф, що майорить назад; (x, y) це місце на шиї
export function drawScarf(
	ctx: Ctx,
	time: number,
	x: number,
	y: number,
	color: string,
): void {
	ctx.strokeStyle = color;
	ctx.lineWidth = 3.2;
	ctx.lineCap = "round";
	ctx.beginPath();
	ctx.moveTo(x, y);
	for (let i = 1; i <= 10; i++) {
		const wave = Math.sin(time * 0.012 + i * 0.7) * 1.8 * (i / 10);
		ctx.lineTo(x - i * 2.4, y - i * 0.35 + wave);
	}
	ctx.stroke();
}
