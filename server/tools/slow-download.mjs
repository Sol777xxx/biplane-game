// Запуск: node tools/slow-download.mjs [url] [КБ/с=2048]
import http from "node:http";
import { setTimeout as sleep } from "node:timers/promises";

const [url = "http://127.0.0.1:3000/api/replays/big-200mb", rateArg = "2048"] =
	process.argv.slice(2);
const bytesPerSec = Number(rateArg) * 1024;

const started = Date.now();
http
	.get(url, async (res) => {
		if (res.statusCode !== 200) {
			console.error(`HTTP ${res.statusCode}`);
			res.resume();
			return;
		}
		const total = Number(res.headers["content-length"]);
		let received = 0;
		let nextReport = 10 * 1024 * 1024;
		// Після кожного шматка пауза: ми не читаємо швидше за bytesPerSec. Сокет переповнюється,
		// і сервер змушений чекати, а не накопичувати дані в пам'яті.
		for await (const chunk of res) {
			received += chunk.length;
			if (received >= nextReport) {
				const sec = (Date.now() - started) / 1000;
				console.log(
					`${(received / 1024 / 1024).toFixed(0)} МБ з ${(total / 1024 / 1024).toFixed(0)}, ${sec.toFixed(0)} с`,
				);
				nextReport += 10 * 1024 * 1024;
			}
			await sleep((chunk.length / bytesPerSec) * 1000);
		}
		const sec = (Date.now() - started) / 1000;
		console.log(
			`готово: ${(received / 1024 / 1024).toFixed(0)} МБ за ${sec.toFixed(0)} с`,
		);
	})
	.on("error", (error) => {
		console.error(error.message);
		process.exit(1);
	});
