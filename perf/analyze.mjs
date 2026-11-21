// Розбір результатів профілювання: чисті функції без введення-виведення, їх тестує
// shared/test/perfAnalyze.test.mjs. Дані приходять з CDP (Profiler, HeapProfiler) і з трасування.

const SPECIAL = new Set([
	"(root)",
	"(idle)",
	"(program)",
	"(garbage collector)",
]);

const base = (url) => url.split(/[\\/]/).pop()?.split("?")[0] ?? "";

// "функція файл:рядок" (рядки в CDP з нуля, людині зручніше з одиниці)
export function labelOf(callFrame) {
	const name = callFrame.functionName || "(anonymous)";
	if (SPECIAL.has(name)) return name;
	const file = base(callFrame.url || "");
	return file ? `${name} ${file}:${callFrame.lineNumber + 1}` : name;
}

const r1 = (v) => Math.round(v * 10) / 10;

// Власний час (self time) кожної функції з .cpuprofile. Тривалість семпла i це дельта до
// наступного семпла: так рахує й DevTools. Повертає { totalMs, activeMs, gcMs, rows }.
// activeMs без (idle); rows без службових вузлів, за спаданням selfMs.
export function selfTime(profile) {
	const byId = new Map(profile.nodes.map((n) => [n.id, n]));
	const acc = new Map();
	let totalMs = 0;
	let idleMs = 0;
	let gcMs = 0;
	const { samples, timeDeltas } = profile;
	for (let i = 0; i < samples.length; i++) {
		const ms = (timeDeltas[i + 1] ?? 0) / 1000;
		totalMs += ms;
		const node = byId.get(samples[i]);
		if (!node) continue;
		const label = labelOf(node.callFrame);
		if (label === "(idle)") idleMs += ms;
		else if (label === "(garbage collector)") gcMs += ms;
		if (SPECIAL.has(label)) continue;
		acc.set(label, (acc.get(label) ?? 0) + ms);
	}
	const activeMs = totalMs - idleMs;
	const rows = [...acc]
		.map(([name, ms]) => ({
			name,
			selfMs: r1(ms),
			pct: activeMs > 0 ? r1((ms / activeMs) * 100) : 0,
		}))
		.sort((a, b) => b.selfMs - a.selfMs);
	return { totalMs: r1(totalMs), activeMs: r1(activeMs), gcMs: r1(gcMs), rows };
}

// Хто виділяє пам'ять: вибірковий профіль купи (HeapProfiler.getSamplingProfile).
// selfSize вузла це байти, виділені саме в цьому місці. Повертає { totalBytes, rows }.
export function topAllocators(profile) {
	const acc = new Map();
	let totalBytes = 0;
	const stack = [profile.head];
	while (stack.length) {
		const node = stack.pop();
		if (node.selfSize > 0) {
			const label = labelOf(node.callFrame);
			acc.set(label, (acc.get(label) ?? 0) + node.selfSize);
			totalBytes += node.selfSize;
		}
		for (const child of node.children ?? []) stack.push(child);
	}
	const rows = [...acc]
		.map(([name, bytes]) => ({
			name,
			bytes,
			pct: totalBytes > 0 ? r1((bytes / totalBytes) * 100) : 0,
		}))
		.sort((a, b) => b.bytes - a.bytes);
	return { totalBytes, rows };
}

const MINOR = new Set(["V8.GCScavenger", "V8.GCMinorMC"]);
const MAJOR = new Set(["V8.GCCompactor", "V8.GCFinalizeMC"]);

// Паузи GC з трасування Chrome (категорії v8, devtools.timeline). Береться процес-рендерер
// з найбільшою кількістю подій GC: це вкладка з грою. Рахуються лише завершені події (ph "X")
// верхнього рівня; incremental marking і конкурентні потоки в паузи не входять.
export function gcStats(events) {
	const renderers = new Set(
		events
			.filter(
				(e) =>
					e.ph === "M" &&
					e.name === "process_name" &&
					e.args?.name === "Renderer",
			)
			.map((e) => e.pid),
	);
	const gc = events.filter(
		(e) =>
			e.ph === "X" &&
			(MINOR.has(e.name) || MAJOR.has(e.name)) &&
			(renderers.size === 0 || renderers.has(e.pid)),
	);
	const perPid = new Map();
	for (const e of gc) perPid.set(e.pid, (perPid.get(e.pid) ?? 0) + 1);
	let pid = null;
	let most = 0;
	for (const [p, n] of perPid) {
		if (n > most) {
			most = n;
			pid = p;
		}
	}
	const empty = () => ({ count: 0, totalMs: 0, maxMs: 0 });
	const out = { minor: empty(), major: empty() };
	for (const e of gc) {
		if (e.pid !== pid) continue;
		const bucket = MAJOR.has(e.name) ? out.major : out.minor;
		const ms = (e.dur ?? 0) / 1000;
		bucket.count++;
		bucket.totalMs += ms;
		bucket.maxMs = Math.max(bucket.maxMs, ms);
	}
	for (const b of [out.minor, out.major]) {
		b.totalMs = r1(b.totalMs);
		b.maxMs = r1(b.maxMs);
	}
	return out;
}

// Markdown-таблиця «показник / значення» для README.
export function toMarkdown(label, s) {
	const f = s.perf.frame;
	const lines = [
		`### ${label}`,
		"",
		"| Показник | Значення |",
		"|---|---|",
		`| Кадр (робота update+render), p50 / p95 / p99 | ${f.p50} / ${f.p95} / ${f.p99} мс |`,
		`| Кадрів довших за 16,7 мс | ${s.perf.slowFrames} з ${f.n} |`,
		...Object.entries(s.perf.spans).map(
			([k, v]) => `| ${k}, p50 / p99 | ${v.p50} / ${v.p99} мс (n=${v.n}) |`,
		),
		`| Паузи minor GC | ${s.gc.minor.count} шт., разом ${s.gc.minor.totalMs} мс, макс ${s.gc.minor.maxMs} мс |`,
		`| Паузи major GC | ${s.gc.major.count} шт., разом ${s.gc.major.totalMs} мс, макс ${s.gc.major.maxMs} мс |`,
		`| Час у GC за профілем CPU | ${s.cpu.gcMs} мс з ${s.cpu.activeMs} мс активного |`,
		"",
		"Топ-3 за власним часом:",
		"",
		...s.cpu.rows
			.slice(0, 3)
			.map((r) => `1. ${r.name}: ${r.selfMs} мс (${r.pct}%)`),
		"",
		"Топ-3 за виділеною пам'яттю:",
		"",
		...s.heap.rows
			.slice(0, 3)
			.map(
				(r) => `1. ${r.name}: ${(r.bytes / 1024).toFixed(0)} КБ (${r.pct}%)`,
			),
		"",
		`Сервер: тік p50 / p99 = ${s.server.tickMs.p50} / ${s.server.tickMs.p99} мс`,
		"",
	];
	return lines.join("\n");
}
