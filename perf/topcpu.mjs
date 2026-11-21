// Топ функцій за власним часом з .cpuprofile (серверним чи клієнтським), у вигляді таблиці
// для README. Запуск: node perf/topcpu.mjs docs/perf/server-prof/CPU.….cpuprofile [скільки=10]
import { readFileSync } from "node:fs";
import { selfTime } from "./analyze.mjs";

const [file, count = "10"] = process.argv.slice(2);
if (!file) {
console.error("Використання: node perf/topcpu.mjs <файл.cpuprofile> [скільки=10]");
process.exit(1);
}
const { totalMs, activeMs, gcMs, rows } = selfTime(JSON.parse(readFileSync(file, "utf8")));
const busy = totalMs > 0 ? Math.round((activeMs / totalMs) * 100) : 0;
console.log(
`Профіль ${(totalMs / 1000).toFixed(1)} с, процесор зайнятий ${busy}% (${(activeMs / 1000).toFixed(1)} с), збірка сміття ${gcMs} мс\n`,
);
console.log("| Функція | Власний час, мс | % активного часу |\n|---|---|---|");
for (const row of rows.slice(0, Number(count))) {
console.log(`| ${row.name} | ${row.selfMs} | ${row.pct}% |`);
}
