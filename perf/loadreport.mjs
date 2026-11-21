// Підсумок навантажувального тесту: ємність і графік. Чисті функції, їх тестує
// shared/test/loadReport.test.mjs.

export const TICK_BUDGET_MS = 1000 / 30; // сервер тікає 30 разів на секунду

const r1 = (v) => Math.round(v * 10) / 10;
const max = (xs) => xs.reduce((a, b) => Math.max(a, b), 0);

// Згортає /api/stats до одного рядка рівня навантаження. rooms: лише матчі, що біжать і мають
// гравців; найгірша кімната визначає, чи тримається тік. eventLoop це вікно з попереднього
// читання /api/stats до цього.
export function summarizeLevel({
	clients,
	stats,
	snapshots,
	seconds,
	generatorLagMs,
}) {
	const rooms = stats.rooms.filter((r) => r.running && r.players > 0);
	const tick = rooms.map((r) => r.tickMs);
	return {
		clients,
		rooms: rooms.length,
		tickMs: {
			p50: r1(max(tick.map((t) => t.p50))),
			p99: r1(max(tick.map((t) => t.p99))),
			max: r1(max(tick.map((t) => t.max))),
		},
		// сума середніх тіків усіх кімнат на 30 Гц: частка секунди, яку сервер витрачає на симуляцію
		simLoad: r1(
			(tick.reduce((s, t) => s + t.avg, 0) * (1000 / TICK_BUDGET_MS)) / 10,
		), // у відсотках
		intervalP99: r1(max(rooms.map((r) => r.intervalMs.p99))),
		lateP99: r1(max(rooms.map((r) => r.lateMs.p99))),
		skipped: rooms.reduce((s, r) => s + r.skipped, 0),
		ticks: rooms.reduce((s, r) => s + r.ticks, 0),
		overruns: rooms.reduce((s, r) => s + r.overruns, 0),
		loopUtilization: stats.eventLoop?.utilization ?? null,
		loopDelayP99: stats.eventLoop ? r1(stats.eventLoop.delayMs.p99) : null,
		rssMb: Math.round(stats.memory.rss / 1048576),
		snapshotsPerClientPerSec: r1(snapshots / clients / seconds),
		generatorLagMs: r1(generatorLagMs),
	};
}

// Цикл подій сервера зайнятий на стільки і більше: він насичений, наступний тік уже запізниться.
// Сам тривалість тіка (1 мс) цього не показує, бо вона міряє лише крок симуляції.
export const MAX_LOOP_UTILIZATION = 0.9;

// Допустима частка пропущених тіків: поодинокий пропуск (збірка сміття, розігрів) не вважається
// перевантаженням, а систематичне відставання так.
export const MAX_SKIPPED_RATIO = 0.01;

// Чому рівень не тримає (null, якщо тримає). Генератор навантаження перевіряється першим:
// якщо він сам відстає, результат вимірює генератор, а не сервер.
export function failure(level) {
	if (level.generatorLagMs >= 20) {
		return `генератор навантаження відстає (${level.generatorLagMs} мс), результат недостовірний`;
	}
	if (level.tickMs.p99 > TICK_BUDGET_MS) {
		return `тік p99 ${level.tickMs.p99} мс більший за ${r1(TICK_BUDGET_MS)} мс`;
	}
	if (level.ticks > 0 && level.skipped / level.ticks > MAX_SKIPPED_RATIO) {
		return `пропущено ${level.skipped} тіків з ${level.ticks}`;
	}
	if (
		level.loopUtilization !== null &&
		level.loopUtilization >= MAX_LOOP_UTILIZATION
	) {
		return `цикл подій сервера зайнятий на ${Math.round(level.loopUtilization * 100)}%`;
	}
	return null;
}

export const holds = (level) => failure(level) === null;

// Ємність N: найбільший рівень, до якого (включно) усе тримається. failedAt: перший рівень,
// що не тримає, і причина; обидва null, якщо ліміт не знайдено й ємність лише оцінена знизу.
export function capacity(levels) {
	let n = 0;
	for (const level of levels) {
		const why = failure(level);
		if (why !== null)
			return { capacity: n, failedAt: level.clients, reason: why };
		n = level.clients;
	}
	return { capacity: n, failedAt: null, reason: null };
}

export function toMarkdown(label, levels) {
	const { capacity: n, failedAt, reason } = capacity(levels);
	const rows = levels.map(
		(l) =>
			`| ${l.clients} | ${l.rooms} | ${l.tickMs.p50} / ${l.tickMs.p99} / ${l.tickMs.max} | ${l.simLoad}% | ${l.loopUtilization === null ? "–" : `${Math.round(l.loopUtilization * 100)}%`} | ${l.lateP99} | ${l.skipped} | ${l.rssMb} | ${holds(l) ? "так" : "ні"} |`,
	);
	return [
		`### ${label}`,
		"",
		"| Клієнтів | Кімнат | Тік p50 / p99 / max, мс | Симуляція, % часу | Цикл подій, % | Запізнення p99, мс | Пропущено | RSS, МБ | Тримає |",
		"|---|---|---|---|---|---|---|---|---|",
		...rows,
		"",
		failedAt === null
			? `Ємність: не досягнута до ${n} клієнтів (тік p99 ≤ ${r1(TICK_BUDGET_MS)} мс на всіх рівнях).`
			: `Ємність N = ${n} клієнтів; на ${failedAt} не тримає: ${reason}.`,
		"",
	].join("\n");
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

// «Гарна» верхня межа осі: крок 1, 2 або 5 × 10^k, п'ять поділок.
function niceTop(want) {
	const mag = 10 ** Math.floor(Math.log10(want / 5));
	return (
		([1, 2, 5, 10].map((k) => k * mag).find((v) => v * 5 >= want) ?? mag * 10) *
		5
	);
}

// SVG-графік з двох панелей на спільній осі клієнтів: зверху тік p50/p99 з бюджетом 33,3 мс,
// знизу завантаження циклу подій з порогом 90%. Тік міряє лише крок симуляції однієї кімнати і
// тому від кількості клієнтів майже не залежить; насичення видно саме на нижній панелі.
export function renderChart(levels, { title = "Навантаження на сервер" } = {}) {
	const W = 720;
	const m = { l: 62, r: 24, t: 56, b: 62, gap: 56 };
	const ph = 230; // висота панелі
	const withLoop = levels.some((l) => l.loopUtilization !== null);
	const H = m.t + ph + (withLoop ? m.gap + ph : 0) + m.b;
	const iw = W - m.l - m.r;
	const x = (i) =>
		m.l + (levels.length === 1 ? iw / 2 : (iw * i) / (levels.length - 1));

	const panel = ({
		top0,
		top,
		unit,
		series,
		threshold,
		thresholdLabel,
		fmt,
	}) => {
		const y = (v) => top0 + ph - (ph * v) / top;
		const line = (pick) =>
			levels
				.map((l, i) => `${x(i).toFixed(1)},${y(pick(l)).toFixed(1)}`)
				.join(" ");
		const grid = Array.from({ length: 6 }, (_, k) => {
			const v = (top * k) / 5;
			return `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="#e5e7eb"/><text x="${m.l - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" font-size="12" fill="#4b5563">${r1(v)}</text>`;
		}).join("");
		const body = series
			.map(
				(s) =>
					`<polyline fill="none" stroke="${s.color}" stroke-width="2.5" points="${line(s.pick)}"/>` +
					levels
						.map(
							(l, i) =>
								`<circle cx="${x(i).toFixed(1)}" cy="${y(s.pick(l)).toFixed(1)}" r="4" fill="${s.color}"><title>${esc(s.name)}: ${fmt(s.pick(l))} при ${l.clients} клієнтах</title></circle>`,
						)
						.join(""),
			)
			.join("");
		const ty = y(threshold).toFixed(1);
		const legend = series
			.map(
				(s, i) =>
					`<rect x="${m.l + i * 150}" y="${top0 - 22}" width="14" height="4" fill="${s.color}"/><text x="${m.l + i * 150 + 20}" y="${top0 - 16}" font-size="13" fill="#111827">${esc(s.name)}</text>`,
			)
			.join("");
		return `${legend}${grid}
<line x1="${m.l}" x2="${W - m.r}" y1="${ty}" y2="${ty}" stroke="#b91c1c" stroke-width="1.5" stroke-dasharray="6 4"/>
<text x="${m.l + 8}" y="${(Number(ty) - 6).toFixed(1)}" font-size="12" fill="#b91c1c">${esc(thresholdLabel)}</text>
${body}
<text transform="translate(16 ${(top0 + ph / 2).toFixed(1)}) rotate(-90)" text-anchor="middle" font-size="13" fill="#111827">${unit}</text>`;
	};

	const tickPanel = panel({
		top0: m.t,
		top: niceTop(
			Math.max(TICK_BUDGET_MS * 1.25, ...levels.map((l) => l.tickMs.p99 * 1.1)),
		),
		unit: "тік, мс",
		series: [
			{ name: "тік p50", color: "#2563eb", pick: (l) => l.tickMs.p50 },
			{ name: "тік p99", color: "#c2410c", pick: (l) => l.tickMs.p99 },
		],
		threshold: TICK_BUDGET_MS,
		thresholdLabel: `бюджет ${r1(TICK_BUDGET_MS)} мс`,
		fmt: (v) => `${v} мс`,
	});
	const loopPanel = withLoop
		? panel({
				top0: m.t + ph + m.gap,
				top: 100,
				unit: "цикл подій, %",
				series: [
					{
						name: "завантаження циклу подій",
						color: "#047857",
						pick: (l) => Math.round((l.loopUtilization ?? 0) * 100),
					},
				],
				threshold: MAX_LOOP_UTILIZATION * 100,
				thresholdLabel: `поріг ${MAX_LOOP_UTILIZATION * 100}%`,
				fmt: (v) => `${v}%`,
			})
		: "";
	const axisY = H - m.b + 22;
	const labels = levels
		.map(
			(l, i) =>
				`<text x="${x(i).toFixed(1)}" y="${axisY}" text-anchor="middle" font-size="12" fill="#4b5563">${l.clients}</text>`,
		)
		.join("");
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui, sans-serif" role="img" aria-labelledby="t d">
<title id="t">${esc(title)}</title>
<desc id="d">Тривалість тіка сервера (p50 і p99, мс) і завантаження його циклу подій (%) для ${levels.map((l) => l.clients).join(", ")} клієнтів. Бюджет тіка ${r1(TICK_BUDGET_MS)} мс, поріг циклу ${MAX_LOOP_UTILIZATION * 100}%.</desc>
<rect width="${W}" height="${H}" fill="#ffffff"/>
<text x="${m.l}" y="20" font-size="15" font-weight="600" fill="#111827">${esc(title)}</text>
${tickPanel}
${loopPanel}
${labels}
<text x="${(m.l + iw / 2).toFixed(1)}" y="${H - 14}" text-anchor="middle" font-size="13" fill="#111827">клієнтів</text>
</svg>
`;
}
