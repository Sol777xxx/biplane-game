import { ARENA } from "../physics.js";
import { drawBiplane } from "./biplane.js";
import { CLOUDS, drawCloud } from "./clouds.js";

export function createRenderer(canvas, { pilotId = "empty" } = {}) {
  const ctx = canvas.getContext("2d");
  let currentPilot = pilotId;
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;

    // внутрішній розмір буфера в фізичних пікселях, CSS-розмір лишається w x h
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);

    // арена масштабується, щоб поміститись у вікно, і центрується
    scale = Math.min(w / ARENA.width, h / ARENA.height);
    offsetX = (w - ARENA.width * scale) / 2;
    offsetY = (h - ARENA.height * scale) / 2;

    // далі малюємо в CSS-пікселях, а canvas сам домножує на dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // інтерполяція; якщо літак «загорнувся» через край, не інтерполюємо
  function lerp(prev, curr, alpha, max) {
    if (Math.abs(curr - prev) > max / 2) return curr;
    return prev + (curr - prev) * alpha;
  }

  function draw(ship, alpha, time) {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    // рамка арени
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.roundRect(0, 0, ARENA.width, ARENA.height, 24);
    ctx.stroke();

    for (const cloud of CLOUDS) drawCloud(ctx, cloud);

    const x = lerp(ship.prevX, ship.x, alpha, ARENA.width);
    const y = lerp(ship.prevY, ship.y, alpha, ARENA.height);
    const pitch = ship.prevPitch + (ship.pitch - ship.prevPitch) * alpha;

    ctx.translate(x, y);
    ctx.scale(ship.facing * 1.6, 1.6); // дзеркалимо, коли летить вліво
    ctx.rotate(pitch);
    drawBiplane(ctx, time, currentPilot);

    ctx.restore();
  }

  window.addEventListener("resize", resize);
  resize();

  return {
    draw,
    resize,
    setPilot(id) {
      currentPilot = id;
    },
  };
}