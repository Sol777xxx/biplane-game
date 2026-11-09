// Запуск: node tools/plot-rss.mjs вихід.svg "підпис=файл.csv" ["підпис2=файл2.csv" ...]
import { readFile, writeFile } from "node:fs/promises";

const [out, ...specs] = process.argv.slice(2);
if (!out || specs.length === 0) {
	console.error(
		'використання: node tools/plot-rss.mjs out.svg "підпис=файл.csv" ...',
	);
	process.exit(1);
}

const esc = (s) =>
	s.replace(
		/[&<>"]/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
	);
const COLORS = ["#2a6fc9", "#c2417d", "#3a9d7a", "#c98a2a"];

const series = [];
for (const spec of specs) {
	const i = spec.lastIndexOf("=");
	const text = await readFile(spec.slice(i + 1), "utf8");
	const rows = text
		.trim()
		.split("\n")
		.slice(1)
		.map((line) => line.split(",").map(Number))
		.filter(([s, mb]) => Number.isFinite(s) && Number.isFinite(mb));
	series.push({ label: spec.slice(0, i), rows });
}

const W = 820;
const H = 440;
const M = { l: 64, r: 24, t: 44, b: 56 };
const maxX = Math.max(...series.flatMap((s) => s.rows.map((r) => r[0])));
const rawY = Math.max(...series.flatMap((s) => s.rows.map((r) => r[1])));
const stepY = rawY > 400 ? 100 : 50;
const maxY = Math.ceil(rawY / stepY) * stepY; // вісь Y від нуля: пласка крива лишається чесною
const stepX = maxX > 120 ? 30 : maxX > 40 ? 10 : 5;
const x = (v) => M.l + (v / maxX) * (W - M.l - M.r);
const y = (v) => H - M.b - (v / maxY) * (H - M.t - M.b);

const parts = [
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="sans-serif" font-size="13">`,
	`<rect width="${W}" height="${H}" fill="#fff"/>`,
	`<text x="${W / 2}" y="24" text-anchor="middle" font-size="16" fill="#333">Пам'ять сервера (rss) під час повільного завантаження логу</text>`,
];
for (let v = 0; v <= maxY; v += stepY) {
	parts.push(
		`<line x1="${M.l}" x2="${W - M.r}" y1="${y(v)}" y2="${y(v)}" stroke="#e3e3e3"/>`,
	);
	parts.push(
		`<text x="${M.l - 8}" y="${y(v) + 4}" text-anchor="end" fill="#555">${v}</text>`,
	);
}
for (let v = 0; v <= maxX; v += stepX) {
	parts.push(
		`<line x1="${x(v)}" x2="${x(v)}" y1="${M.t}" y2="${H - M.b}" stroke="#f0f0f0"/>`,
	);
	parts.push(
		`<text x="${x(v)}" y="${H - M.b + 18}" text-anchor="middle" fill="#555">${v}</text>`,
	);
}
parts.push(
	`<text x="${W / 2}" y="${H - 12}" text-anchor="middle" fill="#333">час, с</text>`,
	`<text x="16" y="${H / 2}" text-anchor="middle" fill="#333" transform="rotate(-90 16 ${H / 2})">rss, МБ</text>`,
);
series.forEach((s, i) => {
	const color = COLORS[i % COLORS.length];
	const points = s.rows
		.map(([sec, mb]) => `${x(sec).toFixed(1)},${y(mb).toFixed(1)}`)
		.join(" ");
	parts.push(
		`<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.5"/>`,
	);
	const ly = M.t + 10 + i * 20;
	parts.push(
		`<line x1="${M.l + 12}" x2="${M.l + 36}" y1="${ly}" y2="${ly}" stroke="${color}" stroke-width="3"/>`,
		`<text x="${M.l + 44}" y="${ly + 4}" fill="#333">${esc(s.label)}</text>`,
	);
});
parts.push("</svg>");

await writeFile(out, parts.join("\n"));
console.log(`записано ${out}`);
