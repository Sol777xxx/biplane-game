// Збирає docs/lab8.md з виміряних файлів: збої (docs/chaos), місткість (docs/perf/loadtest-docker-*),
// RTT (docs/rtt/*.json). Нічого не вигадує: чого немає, того й не показує.
//
//   node perf/lab8-report.mjs
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const list = (dir, re) =>
	existsSync(dir)
		? readdirSync(dir)
				.filter((f) => re.test(f))
				.sort()
		: [];
const out = ["# Лаб 8: виміри хостингу", ""];

out.push("## Збої", "");
const chaos = list("docs/chaos", /^chaos-.*\.json$/);
if (chaos.length === 0)
	out.push("_Не запускалося: `node perf/chaos.mjs all`._", "");
for (const f of chaos) {
	const r = readJson(join("docs/chaos", f));
	out.push(
		`### ${r.label} (${r.when.slice(0, 10)}, Node ${r.node})`,
		"",
		"| Сценарій | Перевірка | Результат | Деталі |",
		"|---|---|---|---|",
	);
	for (const c of r.results.filter((x) => x.name !== "_data")) {
		out.push(
			`| ${c.scenario} | ${c.name} | ${c.skipped ? "пропущено" : c.ok ? "пройшло" : "**провал**"} | ${c.detail ?? ""} |`,
		);
	}
	const data = r.results.find((x) => x.name === "_data")?.data;
	if (data) {
		out.push(
			"",
			`Тік кімнат, які не атакують (32 гравці в 4 кімнатах), під потоком ≈ ${data.framesPerSec} поганих кадрів/с із ${data.attackers} з'єднань:`,
			"",
			"| | Тік p99, мс | Тік max, мс | Пропущено тіків | Цикл подій | Знімків/с на клієнта |",
			"|---|---|---|---|---|---|",
			`| без атаки | ${data.base.tickP99} | ${data.base.tickMax} | ${data.base.skipped} | ${Math.round((data.base.loopUtilization ?? 0) * 100)}% | ${data.base.snapshotsPerClientPerSec} |`,
			`| під атакою | ${data.under.tickP99} | ${data.under.tickMax} | ${data.under.skipped} | ${Math.round((data.under.loopUtilization ?? 0) * 100)}% | ${data.under.snapshotsPerClientPerSec} |`,
		);
	}
	out.push("");
}

out.push("## Скільки гравців витримує один процес", "");
const loads = list("docs/perf", /^loadtest-docker.*\.json$/);
if (loads.length === 0)
	out.push("_Не запускалося: `node perf/measure-docker.mjs`._", "");
else {
	out.push(
		"| Обмеження контейнера | Ємність, гравців | Де перестав триматися | Причина |",
		"|---|---|---|---|",
	);
	for (const f of loads) {
		const r = readJson(join("docs/perf", f));
		out.push(
			`| ${r.label} | **${r.capacity}** | ${r.failedAt ?? "не досягнуто"} | ${r.reason ?? "тік p99 ≤ 33,3 мс на всіх рівнях"} |`,
		);
	}
	out.push(
		"",
		"Повні таблиці рівнів: " +
			loads
				.map(
					(f) =>
						`[${f.replace(".json", ".md")}](perf/${f.replace(".json", ".md")})`,
				)
				.join(", "),
		"",
	);
}

out.push("## RTT до живого сервера", "");
const rtts = list("docs/rtt", /\.json$/);
if (rtts.length === 0)
	out.push(
		'_Не міряли: `node scripts/rtt.mjs <адреса> "…" docs/rtt/<ім\'я>.json`._',
		"",
	);
else {
	out.push(
		"| Хто й звідки | Підключення, мс | RTT min | p50 | p95 | max | Зразків |",
		"|---|---|---|---|---|---|---|",
	);
	for (const f of rtts) {
		const r = readJson(join("docs/rtt", f));
		out.push(
			`| ${r.who ?? f} | ${r.connectMs} | ${r.rttMs.min} | ${r.rttMs.p50} | ${r.rttMs.p95} | ${r.rttMs.max} | ${r.rttMs.samples} |`,
		);
	}
	out.push("");
}
writeFileSync("docs/lab8.md", `${out.join("\n")}\n`);
console.log("docs/lab8.md записано");
