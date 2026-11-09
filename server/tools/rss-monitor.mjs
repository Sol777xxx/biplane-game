// Запуск: node tools/rss-monitor.mjs [url] [вихідний.csv] [інтервал мс=500]. Ctrl+C зупиняє.
import { createWriteStream } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const [
	url = "http://127.0.0.1:3000/health",
	out = "rss.csv",
	intervalArg = "500",
] = process.argv.slice(2);

const file = createWriteStream(out);
file.write("seconds,rss_mb\n");
const started = Date.now();
let stop = false;
process.on("SIGINT", () => {
	stop = true;
});

while (!stop) {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
		const { rss } = await res.json();
		const row = `${((Date.now() - started) / 1000).toFixed(1)},${(rss / 1024 / 1024).toFixed(1)}`;
		file.write(`${row}\n`);
		console.log(row);
	} catch (error) {
		console.warn("health:", error.message);
	}
	await sleep(Number(intervalArg));
}
file.end(() => process.exit(0));
