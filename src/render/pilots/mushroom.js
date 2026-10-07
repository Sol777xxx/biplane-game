// (0, 0) — центр кабіни, герой дивиться праворуч
export const mushroom = {
  id: "mushroom",
  name: "Грибок",
  draw(ctx, time) {
    const sway = Math.sin(time * 0.004) * 0.05;

    // ніжка
    const stem = ctx.createLinearGradient(-4, 0, 5, 0);
    stem.addColorStop(0, "#d9c3ee");
    stem.addColorStop(0.5, "#fbf4ff");
    stem.addColorStop(1, "#c9aee6");
    ctx.fillStyle = stem;
    ctx.strokeStyle = "#8a6aa8";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-4, -8, 8.5, 13, 3);
    ctx.fill();
    ctx.stroke();

    // личко на ніжці
    ctx.fillStyle = "#5a3f78";
    for (const ex of [-0.8, 2.6]) {
      ctx.beginPath();
      ctx.ellipse(ex, -3.6, 0.9, 1.3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(247, 168, 207, 0.7)";
    ctx.beginPath();
    ctx.arc(-2.2, -1.2, 1.1, 0, Math.PI * 2);
    ctx.arc(4, -1.2, 1.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#5a3f78";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.arc(0.9, -1.6, 1.2, 0.2, Math.PI - 0.2);
    ctx.stroke();

    // капелюшок (злегка гойдається навколо основи)
    ctx.save();
    ctx.translate(0, -7);
    ctx.rotate(sway);
    ctx.translate(0, 7);

    const cap = () => {
      ctx.beginPath();
      ctx.moveTo(-10, -7);
      ctx.bezierCurveTo(-12, -18, -3, -24, 4, -21);
      ctx.bezierCurveTo(9, -19, 13, -13, 12, -9);
      ctx.quadraticCurveTo(1, -4, -10, -7);
      ctx.closePath();
    };

    const rainbow = ctx.createLinearGradient(-10, -22, 12, -6);
    rainbow.addColorStop(0, "#c8f5dc");
    rainbow.addColorStop(0.3, "#b9d9ff");
    rainbow.addColorStop(0.6, "#d3b3f7");
    rainbow.addColorStop(1, "#ff9fd0");
    cap();
    ctx.fillStyle = rainbow;
    ctx.fill();

    ctx.save();
    cap();
    ctx.clip();
    // м'яка кольорова пляма, як перламутр
    const glow = ctx.createRadialGradient(-3, -11, 1, -3, -11, 12);
    glow.addColorStop(0, "rgba(255, 244, 170, 0.75)");
    glow.addColorStop(1, "rgba(255, 244, 170, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(-14, -26, 30, 24);
    // тінь під капелюшком
    ctx.fillStyle = "rgba(138, 106, 168, 0.25)";
    ctx.fillRect(-14, -8.5, 30, 6);
    ctx.restore();

    // відблиски
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.beginPath();
    ctx.ellipse(-3, -18, 2.2, 1.4, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(6, -14.5, 0.9, 0, Math.PI * 2);
    ctx.fill();

    cap();
    ctx.strokeStyle = "#8a6aa8";
    ctx.lineWidth = 1.1;
    ctx.stroke();

    // зірочки, що мерехтять
    for (const [sx, sy, phase] of [
      [-6, -12, 0],
      [8, -17, 2],
    ]) {
      const a = 0.5 + 0.5 * Math.sin(time * 0.006 + phase);
      ctx.fillStyle = `rgba(255, 255, 255, ${a})`;
      ctx.beginPath();
      ctx.moveTo(sx, sy - 2);
      ctx.lineTo(sx + 0.6, sy - 0.6);
      ctx.lineTo(sx + 2, sy);
      ctx.lineTo(sx + 0.6, sy + 0.6);
      ctx.lineTo(sx, sy + 2);
      ctx.lineTo(sx - 0.6, sy + 0.6);
      ctx.lineTo(sx - 2, sy);
      ctx.lineTo(sx - 0.6, sy - 0.6);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  },
};