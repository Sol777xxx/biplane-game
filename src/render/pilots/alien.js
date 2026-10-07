// (0, 0) — центр кабіни, герой дивиться праворуч
export const alien = {
  id: "alien",
  name: "Зелений чоловічок",
  draw(ctx, time) {
    const sway = Math.sin(time * 0.006) * 1.3;
    const outline = "#2f6b4a";

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // антени
    const antennas = [
      { sx: -2.5, sy: -17, cx: -6, cy: -21, ex: -8.5, ey: -24.5 },
      { sx: 4, sy: -18, cx: 1, cy: -23, ex: -2, ey: -27 },
    ];
    for (const a of antennas) {
      const ex = a.ex + sway;
      ctx.strokeStyle = outline;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      ctx.quadraticCurveTo(a.cx + sway * 0.5, a.cy, ex, a.ey);
      ctx.stroke();

      const ball = ctx.createRadialGradient(ex - 0.7, a.ey - 0.7, 0.3, ex, a.ey, 2.6);
      ball.addColorStop(0, "#e6ffd9");
      ball.addColorStop(1, "#7fd88a");
      ctx.fillStyle = ball;
      ctx.beginPath();
      ctx.arc(ex, a.ey, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
      ctx.beginPath();
      ctx.arc(ex - 0.8, a.ey - 0.8, 0.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // тіло
    const body = ctx.createLinearGradient(0, -6, 0, 6);
    body.addColorStop(0, "#8fe39a");
    body.addColorStop(1, "#4fb27a");
    ctx.fillStyle = body;
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(0, 0, 5.2, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // рука, що махає
    ctx.fillStyle = "#6fd08a";
    ctx.save();
    ctx.translate(-4, -3);
    ctx.rotate(-0.9 + Math.sin(time * 0.012) * 0.25);
    ctx.beginPath();
    ctx.roundRect(-1.4, -7, 2.8, 8, 1.4);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // голова
    const head = ctx.createRadialGradient(1, -14, 1, 1, -11, 10);
    head.addColorStop(0, "#d4ffc2");
    head.addColorStop(0.6, "#8fe39a");
    head.addColorStop(1, "#4fb27a");
    ctx.fillStyle = head;
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.ellipse(1, -11, 9, 7.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // цяточки на маківці
    ctx.fillStyle = "rgba(47, 107, 74, 0.35)";
    for (const [px, py, pr] of [
      [-3, -17.5, 0.6],
      [0, -18.3, 0.8],
      [3.5, -17.8, 0.6],
      [6, -16.5, 0.5],
    ]) {
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, Math.PI * 2);
      ctx.fill();
    }

    // відблиск на голові
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.beginPath();
    ctx.ellipse(-4.5, -14.5, 1.8, 1, -0.6, 0, Math.PI * 2);
    ctx.fill();

    // очі
    for (const ex of [-0.5, 6.2]) {
      ctx.fillStyle = "#12304a";
      ctx.beginPath();
      ctx.ellipse(ex, -10.5, 3, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(ex + 0.6, -11.8, 1.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ex - 0.9, -9.2, 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#9fe8f2";
      ctx.beginPath();
      ctx.arc(ex + 1, -8.6, 0.45, 0, Math.PI * 2);
      ctx.fill();
    }

    // брови
    ctx.strokeStyle = outline;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-3, -15);
    ctx.quadraticCurveTo(-0.5, -16.2, 1.8, -15.2);
    ctx.moveTo(4, -15.2);
    ctx.quadraticCurveTo(6.5, -16.2, 8.6, -15);
    ctx.stroke();

    // щічки
    ctx.fillStyle = "rgba(255, 150, 190, 0.5)";
    ctx.beginPath();
    ctx.arc(-2.5, -6.2, 1.2, 0, Math.PI * 2);
    ctx.arc(8.2, -6.2, 1.2, 0, Math.PI * 2);
    ctx.fill();

    // усмішка
    ctx.strokeStyle = "#12304a";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(3, -6.6, 1.5, 0.2, Math.PI - 0.2);
    ctx.stroke();
  },
};