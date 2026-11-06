// sequential await vs Promise.all на однаковому наборі «файлів» із затримкою.
// Запуск: node demo/timing.mjs
import http from "node:http";
import { loadAll } from "../src/assets/loader.js";

const LATENCY = 250; // мс на файл, як повільна мережа
const FILES = 8;

const server = http.createServer((_req, res) => {
	setTimeout(() => res.end('{"ok":true}'), LATENCY);
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const manifest = {
	assets: Array.from({ length: FILES }, (_, i) => ({
		id: `file${i}`,
		type: "json",
		url: `${base}/f${i}.json`,
	})),
};

const rows = [];
for (const mode of ["sequential", "concurrent"]) {
	const times = [];
	for (let run = 0; run < 3; run++) {
		times.push((await loadAll(manifest, { mode })).ms);
	}
	const avg = times.reduce((a, b) => a + b, 0) / times.length;
	rows.push({ mode, avg });
	console.log(
		`${mode.padEnd(10)} ${times.map((t) => t.toFixed(0)).join(", ")} мс, середнє ${avg.toFixed(0)} мс`,
	);
}
console.log(
	`різниця: ×${(rows[0].avg / rows[1].avg).toFixed(1)} (${FILES} файлів по ${LATENCY} мс)`,
);
server.close();
