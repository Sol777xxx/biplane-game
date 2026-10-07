export function drawWing(ctx, x, y, w, h, base, light, dark) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y + h * 0.6);
  ctx.quadraticCurveTo(x, y + h, x + h * 0.7, y + h);
  ctx.lineTo(x + w - h * 0.7, y + h);
  ctx.quadraticCurveTo(x + w, y + h, x + w, y + h * 0.6);
  ctx.quadraticCurveTo(x + w * 0.85, y - h * 0.3, x + w * 0.5, y - h * 0.3);
  ctx.quadraticCurveTo(x + w * 0.15, y - h * 0.3, x, y + h * 0.6);
  ctx.closePath();
  ctx.fillStyle = base;
  ctx.fill();
  ctx.clip();

  // тінь знизу
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = dark;
  ctx.fillRect(x, y + h * 0.65, w, h);

  // нервюри
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = dark;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let i = 1; i < 8; i++) {
    const xi = x + (w * i) / 8;
    ctx.moveTo(xi, y - h * 0.3);
    ctx.lineTo(xi, y + h);
  }
  ctx.stroke();

  // відблиск
  ctx.globalAlpha = 1;
  ctx.strokeStyle = light;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.1, y + h * 0.25);
  ctx.quadraticCurveTo(x + w * 0.5, y - h * 0.3, x + w * 0.9, y + h * 0.25);
  ctx.stroke();
  ctx.restore();

  // нижня кромка
  ctx.strokeStyle = dark;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(x + h * 0.6, y + h);
  ctx.lineTo(x + w - h * 0.6, y + h);
  ctx.stroke();
}

export function drawStrut(ctx, x1, y1, x2, y2, width) {
  ctx.strokeStyle = "#7d68b0";
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  // світла смужка для об'єму
  ctx.strokeStyle = "#cdbdf0";
  ctx.lineWidth = width * 0.35;
  ctx.beginPath();
  ctx.moveTo(x1 - width * 0.2, y1);
  ctx.lineTo(x2 - width * 0.2, y2);
  ctx.stroke();
}