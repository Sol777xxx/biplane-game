// Запуск: node tools/make-big-log.mjs [МБ=200] [ім'я=big-200mb]
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { loadConfig } from "../src/config.js";
import { REPLAY_ID } from "../src/replayRoutes.js";

const [mbArg = "200", name = "big-200mb"] = process.argv.slice(2);
const mb = Number(mbArg);
if (!(mb > 0) || !REPLAY_ID.test(name)) {
	console.error(
		"використання: node tools/make-big-log.mjs [МБ] [ім'я з літер, цифр, _ і -]",
	);
	process.exit(1);
}

const { logDir } = loadConfig();
await mkdir(logDir, { recursive: true });
const file = path.join(logDir, `${name}.ndjson`);
const target = mb * 1024 * 1024;
const NAMES = ["Оля", "Тарас", "Марія", "Іван"];

async function* chunks() {
	let bytes = 0;
	let n = 0;
	let t = Date.now() - 3_600_000;
	let nextReport = 0.1;
	while (bytes < target) {
		let chunk = "";
		for (let i = 0; i < 500; i++, n++) {
			t += 1 + (n % 7);
			const who = n % 4;
			const event =
				n % 10 === 0
					? {
							t,
							type: "chat",
							player: `p${who}`,
							name: NAMES[who],
							text: `повідомлення номер ${n}`,
						}
					: {
							t,
							type: "move",
							player: `p${who}`,
							x: (n * 37) % 1920,
							y: (n * 91) % 1080,
							seq: n,
						};
			chunk += `${JSON.stringify(event)}\n`;
		}
		bytes += Buffer.byteLength(chunk);
		if (bytes / target >= nextReport) {
			console.log(`${Math.round((bytes / target) * 100)}%`);
			nextReport += 0.1;
		}
		yield chunk;
	}
}

// pipeline сам стежить за backpressure: генератор не випереджає диск
await pipeline(chunks(), createWriteStream(file));
console.log(`готово: ${file}`);
