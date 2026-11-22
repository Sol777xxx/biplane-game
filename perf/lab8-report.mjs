// Збирає docs/lab8.md з виміряних файлів: збої (docs/chaos), місткість (docs/perf/loadtest-docker-*),
// RTT (docs/rtt/*.json), і оновлює ці ж таблиці в README між мітками <!-- lab8:ім'я -->.
// Нічого не вигадує: чого немає, того й не показує.
//
//   node perf/lab8-report.mjs [--video https://посилання-на-відео]
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({ options: { video: { type: "string" } } });
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const list = (dir, re) =>
	existsSync(dir)
		? readdirSync(dir)
				.filter((f) => re.test(f))
				.sort()
		: [];
const status = (c) =>
	c.skipped ? "пропущено" : c.ok ? "пройшло" : "**провал**";

// ---------- збої ----------
function chaosTable(r) {
	const rows = r.results.filter((x) => x.name !== "_data");
	return [
		"| Сценарій | Перевірка | Результат | Деталі |",
		"|---|---|---|---|",
		...rows.map(
			(c) => `| ${c.scenario} | ${c.name} | ${status(c)} | ${c.detail ?? ""} |`,
		),
	].join("\n");
}
function floodTable(r) {
	const data = r.results.find((x) => x.name === "_data")?.data;
	if (!data) return "";
	const row = (name, d) =>
		`| ${name} | ${d.tickP99} | ${d.tickMax} | ${d.skipped} | ${Math.round((d.loopUtilization ?? 0) * 100)}% | ${d.snapshotsPerClientPerSec} |`;
	return [
		`Тік кімнат, які не атакують (32 гравці в 4 кімнатах), під потоком ≈ ${data.framesPerSec} поганих кадрів/с із ${data.attackers} з'єднань:`,
		"",
		"| | Тік p99, мс | Тік max, мс | Пропущено тіків | Цикл подій | Знімків/с на клієнта |",
		"|---|---|---|---|---|---|",
		row("без атаки", data.base),
		row("під атакою", data.under),
	].join("\n");
}
const chaosFiles = list("docs/chaos", /^chaos-.*\.json$/);
const chaosRuns = chaosFiles.map((f) => readJson(join("docs/chaos", f)));

// ---------- місткість ----------
const loadFiles = list("docs/perf", /^loadtest-docker.*\.json$/);
function capacityTable() {
	if (loadFiles.length === 0)
		return "_Не запускалося: `node perf/measure-docker.mjs`._";
	const rows = loadFiles.map((f) => {
		const r = readJson(join("docs/perf", f));
		return `| ${r.label} | **${r.capacity}** | ${r.failedAt ?? "не досягнуто"} | ${r.reason ?? "тік p99 ≤ 33,3 мс на всіх рівнях"} |`;
	});
	const links = loadFiles
		.map(
			(f) =>
				`[${f.replace(".json", "")}](docs/perf/${f.replace(".json", ".md")})`,
		)
		.join(", ");
	return [
		"| Обмеження контейнера | Ємність, гравців | Де перестав триматися | Причина |",
		"|---|---|---|---|",
		...rows,
		"",
		`Повні таблиці рівнів і графіки: ${links}.`,
	].join("\n");
}

// ---------- RTT ----------
const rttFiles = list("docs/rtt", /\.json$/);
function rttTable() {
	if (rttFiles.length === 0)
		return '_Не міряли: `node scripts/rtt.mjs <адреса> "…" docs/rtt/<ім\'я>.json`._';
	return [
		"| Хто й звідки | Підключення, мс | RTT min | p50 | p95 | max | Зразків |",
		"|---|---|---|---|---|---|---|",
		...rttFiles.map((f) => {
			const r = readJson(join("docs/rtt", f));
			return `| ${r.who ?? f} | ${r.connectMs} | ${r.rttMs.min} | ${r.rttMs.p50} | ${r.rttMs.p95} | ${r.rttMs.max} | ${r.rttMs.samples} |`;
		}),
	].join("\n");
}

// ---------- docs/lab8.md ----------
const out = ["# Лаб 8: виміри хостингу", "", "## Збої", ""];
if (chaosRuns.length === 0)
	out.push("_Не запускалося: `node perf/chaos.mjs all`._", "");
for (const r of chaosRuns) {
	out.push(
		`### ${r.label} (${r.when.slice(0, 10)}, Node ${r.node})`,
		"",
		chaosTable(r),
		"",
	);
	const flood = floodTable(r);
	if (flood) out.push(flood, "");
}
out.push("## Скільки гравців витримує один процес", "", capacityTable(), "");
out.push("## RTT до живого сервера", "", rttTable(), "");
writeFileSync("docs/lab8.md", `${out.join("\n")}\n`);
console.log("docs/lab8.md записано");

// ---------- README ----------
if (existsSync("README.md")) {
	let readme = readFileSync("README.md", "utf8");
	// у README потрапляє найповніший запуск на Linux (мітка linux-ci), інакше останній
	const best =
		chaosRuns.find((r) => r.label === "linux-ci") ?? chaosRuns.at(-1);
	const chaos = best
		? [
				`Запуск \`${best.label}\` (${best.when.slice(0, 10)}, Node ${best.node}):`,
				"",
				chaosTable(best),
				"",
				floodTable(best),
			].join("\n")
		: "_Ще не запускалося._";
	const blocks = { chaos, capacity: capacityTable(), rtt: rttTable() };
	if (args.video) blocks.video = `[дивитись](${args.video})`;
	for (const [name, body] of Object.entries(blocks)) {
		const re = new RegExp(
			`(<!-- lab8:${name} -->)[\\s\\S]*?(<!-- /lab8:${name} -->)`,
		);
		if (!re.test(readme)) {
			console.warn(`у README немає мітки lab8:${name}`);
			continue;
		}
		const inline = name === "video";
		readme = readme.replace(re, (_m, a, b) =>
			inline ? `${a}${body}${b}` : `${a}\n${body}\n${b}`,
		);
	}
	writeFileSync("README.md", readme);
	console.log("README.md оновлено");
}
