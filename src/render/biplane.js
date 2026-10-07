import { drawStrut, drawWing } from "./parts.js";
import { getPilot } from "./pilots/index.js";

// точка сидіння пілота в координатах літака
const SEAT = { x: 8, y: -10 };

// ---------- хвіст ----------
function drawTail(ctx) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // хвостовий костиль
  ctx.strokeStyle = "#8f78c4";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-55, 3);
  ctx.lineTo(-60, 11);
  ctx.stroke();
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(-57, 5);
  ctx.lineTo(-59.5, 5.8);
  ctx.lineTo(-57.5, 7.2);
  ctx.lineTo(-60, 8);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-65, 12.5);
  ctx.quadraticCurveTo(-60, 14, -55.5, 11.5);
  ctx.stroke();

  // стабілізатор
  const stabilizer = () => {
    ctx.beginPath();
    ctx.moveTo(-42, -1.5);
    ctx.lineTo(-70, -3.5);
    ctx.quadraticCurveTo(-77, -0.5, -70, 3);
    ctx.lineTo(-42, 2.5);
    ctx.closePath();
  };
  stabilizer();
  ctx.fillStyle = "#c9b3f2";
  ctx.fill();
  ctx.save();
  stabilizer();
  ctx.clip();
  // руль висоти
  ctx.fillStyle = "#f7a8cf";
  ctx.fillRect(-80, -6, 20, 12);
  ctx.strokeStyle = "rgba(216, 112, 159, 0.6)";
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  for (const x of [-64, -68, -72]) {
    ctx.moveTo(x, -5);
    ctx.lineTo(x, 4);
  }
  ctx.stroke();
  // шарнір
  ctx.strokeStyle = "#8f78c4";
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(-60, -4);
  ctx.lineTo(-60, 3.5);
  ctx.stroke();
  ctx.restore();
  stabilizer();
  ctx.strokeStyle = "#a68ad8";
  ctx.lineWidth = 1;
  ctx.stroke();

  // кіль
  const fin = () => {
    ctx.beginPath();
    ctx.moveTo(-40, -5);
    ctx.quadraticCurveTo(-52, -9, -58, -26);
    ctx.quadraticCurveTo(-62, -33, -69, -31);
    ctx.quadraticCurveTo(-75, -27, -73, -18);
    ctx.lineTo(-66, -2);
    ctx.closePath();
  };
  const finGradient = ctx.createLinearGradient(-72, -32, -44, -2);
  finGradient.addColorStop(0, "#e2d5fb");
  finGradient.addColorStop(1, "#b79fe8");
  fin();
  ctx.fillStyle = finGradient;
  ctx.fill();

  ctx.save();
  fin();
  ctx.clip();

  // стерно напрямку
  const rudder = ctx.createLinearGradient(-76, -34, -62, 0);
  rudder.addColorStop(0, "#ffd0e6");
  rudder.addColorStop(1, "#f092bd");
  ctx.fillStyle = rudder;
  ctx.beginPath();
  ctx.moveTo(-62, -34);
  ctx.lineTo(-80, -36);
  ctx.lineTo(-80, 0);
  ctx.lineTo(-64.5, 0);
  ctx.closePath();
  ctx.fill();

  // нервюри стерна
  ctx.strokeStyle = "rgba(216, 112, 159, 0.55)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (const y of [-27, -21, -15, -9, -4]) {
    ctx.moveTo(-80, y);
    ctx.lineTo(-63, y + 0.8);
  }
  ctx.stroke();

  // шарнір і кріплення
  ctx.strokeStyle = "#8f78c4";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-62, -32);
  ctx.lineTo(-64.5, -1);
  ctx.stroke();
  ctx.fillStyle = "#7d68b0";
  for (const y of [-24, -14, -5]) {
    ctx.beginPath();
    ctx.arc(-63 - (y + 24) * 0.02, y, 0.9, 0, Math.PI * 2);
    ctx.fill();
  }

  // відблиск на передній кромці кіля
  ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-46, -9);
  ctx.quadraticCurveTo(-54, -13, -58, -24);
  ctx.stroke();

  // сердечко на стерні
  ctx.fillStyle = "#fff3f9";
  ctx.beginPath();
  ctx.moveTo(-69, -13);
  ctx.bezierCurveTo(-74, -17, -72, -21, -69, -18.5);
  ctx.bezierCurveTo(-66, -21, -64, -17, -69, -13);
  ctx.fill();
  ctx.restore();

  fin();
  ctx.strokeStyle = "#a68ad8";
  ctx.lineWidth = 1;
  ctx.stroke();

  // вогник на верхівці
  ctx.fillStyle = "#ffe27a";
  ctx.beginPath();
  ctx.arc(-69, -32, 1.4, 0, Math.PI * 2);
  ctx.fill();
}

// ---------- ніс: капот, радіатор, пропелер ----------
function drawNose(ctx, time) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // вихлопні труби
  ctx.strokeStyle = "#8f78c4";
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(35, 9);
  ctx.quadraticCurveTo(31, 15, 22, 14);
  ctx.moveTo(40, 10);
  ctx.quadraticCurveTo(36, 17, 27, 16);
  ctx.stroke();
  ctx.strokeStyle = "#cdbdf0";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(35, 8.4);
  ctx.quadraticCurveTo(31, 14.4, 22, 13.4);
  ctx.stroke();

  // головки циліндрів
  ctx.fillStyle = "#d9c9f5";
  ctx.strokeStyle = "#8f78c4";
  ctx.lineWidth = 0.8;
  for (const x of [33.5, 40.5]) {
    ctx.beginPath();
    ctx.roundRect(x, -15, 4.5, 4, 1.5);
    ctx.fill();
    ctx.stroke();
  }

  // капот
  const cowling = () => {
    ctx.beginPath();
    ctx.roundRect(31, -12, 17, 24, 6);
  };
  const cowlGradient = ctx.createLinearGradient(0, -12, 0, 12);
  cowlGradient.addColorStop(0, "#ffd0e6");
  cowlGradient.addColorStop(0.5, "#f7a8cf");
  cowlGradient.addColorStop(1, "#e07fb0");
  cowling();
  ctx.fillStyle = cowlGradient;
  ctx.fill();

  ctx.save();
  cowling();
  ctx.clip();

  // смуги
  ctx.fillStyle = "#8f78c4";
  ctx.fillRect(35, -13, 2.6, 26);
  ctx.globalAlpha = 0.7;
  ctx.fillRect(39.5, -13, 1.4, 26);
  ctx.globalAlpha = 1;

  // відблиск
  ctx.strokeStyle = "rgba(255, 255, 255, 0.65)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(32, -8);
  ctx.lineTo(47, -8);
  ctx.stroke();

  // заклепки
  ctx.fillStyle = "rgba(125, 104, 176, 0.7)";
  for (const y of [-8, -3, 2, 7]) {
    ctx.beginPath();
    ctx.arc(33, y, 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  cowling();
  ctx.strokeStyle = "#e58ab9";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // кільце радіатора
  ctx.fillStyle = "#efe6fb";
  ctx.strokeStyle = "#8f78c4";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(48, 0, 3, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "#cdbdf0";
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  for (const y of [-7, -3.5, 0, 3.5, 7]) {
    ctx.moveTo(46.8, y);
    ctx.lineTo(49.2, y);
  }
  ctx.stroke();

  // пропелер
  const blade = 6 + 16 * Math.abs(Math.sin(time * 0.03));
  ctx.fillStyle = "rgba(155, 127, 199, 0.16)";
  ctx.beginPath();
  ctx.ellipse(52, 0, 3.2, 22, 0, 0, Math.PI * 2);
  ctx.fill();
  for (const dir of [-1, 1]) {
    ctx.fillStyle = "rgba(155, 127, 199, 0.55)";
    ctx.strokeStyle = "rgba(125, 104, 176, 0.8)";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(52, 0);
    ctx.quadraticCurveTo(54.2, dir * blade * 0.5, 52, dir * blade);
    ctx.quadraticCurveTo(50.4, dir * blade * 0.5, 52, 0);
    ctx.fill();
    ctx.stroke();
  }

  // обтічник
  const spinner = ctx.createLinearGradient(0, -5, 0, 5);
  spinner.addColorStop(0, "#ffffff");
  spinner.addColorStop(1, "#d9c9f5");
  ctx.fillStyle = spinner;
  ctx.strokeStyle = "#8f78c4";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(49, -5.5);
  ctx.quadraticCurveTo(56, -3.5, 59, 0);
  ctx.quadraticCurveTo(56, 3.5, 49, 5.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(51, -3.2);
  ctx.quadraticCurveTo(54, -2.6, 56, -1.2);
  ctx.stroke();
}

// ---------- кабіна ----------
function drawCockpit(ctx, time, pilotId) {
  // чаша закриває обводку фюзеляжу в отворі
  ctx.fillStyle = "#9b86c9";
  ctx.beginPath();
  ctx.moveTo(-5, -13.8);
  ctx.quadraticCurveTo(9, -16.4, 23, -13.8);
  ctx.quadraticCurveTo(21, -3, 8, -3);
  ctx.quadraticCurveTo(-3, -3, -5, -13.8);
  ctx.closePath();
  ctx.fill();

  // внутрішня тінь
  ctx.fillStyle = "rgba(90, 70, 140, 0.35)";
  ctx.beginPath();
  ctx.ellipse(9, -6, 9, 2.4, 0, 0, Math.PI * 2);
  ctx.fill();

  // підголівник
  ctx.fillStyle = "#f7a8cf";
  ctx.beginPath();
  ctx.roundRect(-8, -18, 7, 8, 3);
  ctx.fill();

  // верхній край чаші (за героєм)
  ctx.strokeStyle = "#b79fe8";
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-5, -13.8);
  ctx.quadraticCurveTo(9, -16.4, 23, -13.8);
  ctx.stroke();

  // герой у чаші
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-40, -80);
  ctx.lineTo(40, -80);
  ctx.lineTo(40, -13.8);
  ctx.lineTo(23, -13.8);
  ctx.quadraticCurveTo(21, -3, 8, -3);
  ctx.quadraticCurveTo(-3, -3, -5, -13.8);
  ctx.lineTo(-40, -13.8);
  ctx.closePath();
  ctx.clip();
  ctx.translate(SEAT.x, SEAT.y);
  getPilot(pilotId).draw(ctx, time);
  ctx.restore();

  // лобове скло
  ctx.fillStyle = "rgba(207, 232, 255, 0.85)";
  ctx.strokeStyle = "#8f78c4";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(24, -13);
  ctx.lineTo(29, -20);
  ctx.lineTo(32, -20);
  ctx.lineTo(28, -12);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

// ---------- літак ----------
export function drawBiplane(ctx, time, pilotId) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // дальні крила
  drawWing(ctx, -12, -46, 66, 8, "#d4f3e6", "#f2fcf8", "#a6d9c6");
  drawWing(ctx, -42, 12, 56, 7, "#fbd3e6", "#fff0f7", "#e8a7c6");

  drawTail(ctx);

  // шасі
  ctx.strokeStyle = "#8f78c4";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(14, 12);
  ctx.lineTo(21, 23);
  ctx.moveTo(31, 12);
  ctx.lineTo(27, 23);
  ctx.moveTo(19, 23);
  ctx.lineTo(31, 23);
  ctx.stroke();
  ctx.fillStyle = "#7d68b0";
  ctx.beginPath();
  ctx.arc(25, 26, 6.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e8def9";
  ctx.beginPath();
  ctx.arc(25, 26, 2.4, 0, Math.PI * 2);
  ctx.fill();

  // фюзеляж
  const fuselage = () => {
    ctx.beginPath();
    ctx.moveTo(40, -11);
    ctx.bezierCurveTo(10, -16, -30, -10, -62, -3);
    ctx.lineTo(-62, 3);
    ctx.bezierCurveTo(-30, 8, 10, 16, 40, 11);
    ctx.closePath();
  };

  const body = ctx.createLinearGradient(0, -14, 0, 13);
  body.addColorStop(0, "#fffafd");
  body.addColorStop(0.6, "#fff0f7");
  body.addColorStop(1, "#f6d3e6");
  fuselage();
  ctx.fillStyle = body;
  ctx.fill();

  ctx.save();
  fuselage();
  ctx.clip();

  // лінії панелей
  ctx.strokeStyle = "rgba(229, 138, 185, 0.5)";
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  for (const px of [-48, -34, -20, -6]) {
    ctx.moveTo(px, -16);
    ctx.quadraticCurveTo(px + 2, 0, px, 14);
  }
  ctx.stroke();

  // смужка
  ctx.strokeStyle = "#f7a8cf";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-60, 0.5);
  ctx.bezierCurveTo(-30, 3, 0, 6, 32, 6);
  ctx.stroke();

  // пунктир
  ctx.setLineDash([1.5, 4]);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-60, 0.5);
  ctx.bezierCurveTo(-30, 3, 0, 6, 32, 6);
  ctx.stroke();
  ctx.setLineDash([]);

  // сердечко на борту
  ctx.fillStyle = "#f7a8cf";
  ctx.beginPath();
  ctx.moveTo(-29, -4);
  ctx.bezierCurveTo(-35, -9, -32, -13, -29, -10);
  ctx.bezierCurveTo(-26, -13, -23, -9, -29, -4);
  ctx.fill();

  // відблиск зверху
  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-50, -4);
  ctx.bezierCurveTo(-25, -8, 0, -12, 30, -10);
  ctx.stroke();
  ctx.restore();

  fuselage();
  ctx.strokeStyle = "#e58ab9";
  ctx.lineWidth = 1.8;
  ctx.stroke();

  // стійки від фюзеляжу до верхнього крила
  drawStrut(ctx, 4, -13, 14, -35, 1.8);
  drawStrut(ctx, 26, -13, 32, -35, 1.8);

  drawCockpit(ctx, time, pilotId);

  // міжкрилові стійки
  drawStrut(ctx, 52, -35, 22, 10, 2.6);
  drawStrut(ctx, 40, -35, 10, 10, 2.6);
  drawStrut(ctx, 0, -35, 0, 9, 1.8);

  // ближні крила
  drawWing(ctx, -4, -42, 66, 8, "#a8e6cf", "#e6fbf2", "#5fb89a");
  drawWing(ctx, -34, 9, 56, 7, "#f7a8cf", "#ffe3f0", "#d8709f");

  drawNose(ctx, time);
}