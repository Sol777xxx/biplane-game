// RTT до живого сервера з підписом, хто й звідки міряв: запускає scripts/smoke.mjs і зберігає
// його JSON у файл. Далі `node perf/lab8-report.mjs` збирає всі файли в таблицю.
//
//   node scripts/rtt.mjs https://biplane-game-latest.onrender.com "Ім'я, місто, Wi-Fi" docs/rtt/imya.json
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const [target, who, out] = process.argv.slice(2);
if (!target || !who || !out) {
	console.error(
		'Використання: node scripts/rtt.mjs <https://адреса> "<хто й звідки>" <файл.json>',
	);
	process.exit(2);
}
const r = spawnSync(
	process.execPath,
	["scripts/smoke.mjs", target, "--pings", "20"],
	{ encoding: "utf8" },
);
process.stdout.write(r.stdout);
process.stderr.write(r.stderr);
const text = r.stdout;
const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
if (r.status !== 0 || !json) {
	console.error("smoke не пройшов: результат не збережено");
	process.exit(1);
}
const result = { ...JSON.parse(json), who, when: new Date().toISOString() };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(result, null, "\t")}\n`);
console.log(`збережено: ${out}`);
