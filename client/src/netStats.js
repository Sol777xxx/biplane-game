// Метрики netgraph: проміжки між знімками, RTT, швидкості, поправки.
// Без DOM і власного годинника: час передається ззовні, тож це перевіряється в Node.
const RING = 120; // проміжків між знімками (~4 с)
const RTT_RING = 10; // останні RTT (~10 с)
const CORR_RING = 30; // останні поправки (~1 с)

const push = (list, value, max) => {
	list.push(value);
	if (list.length > max) list.shift();
};

// n, середнє, p95 і максимум (для дослідів із консолі й скриптів)
export function summarize(values) {
	const n = values.length;
	if (n === 0) return { n: 0, mean: 0, p95: 0, max: 0 };
	const xs = [...values].sort((a, b) => a - b);
	const mean = xs.reduce((a, b) => a + b, 0) / n;
	const r = (v) => Math.round(v * 100) / 100;
	return {
		n,
		mean: r(mean),
		p95: r(xs[Math.min(n - 1, Math.ceil(0.95 * n) - 1)]),
		max: r(xs[n - 1]),
	};
}

export function createNetStats({ now = () => performance.now() } = {}) {
	const intervals = [];
	const rtts = [];
	const corrs = [];
	let lastAt = null; // коли прийшов останній знімок
	let total = 0;
	let base = null; // точка відліку швидкостей
	let rates = { snapsPerSec: 0, bytesInPerSec: 0, bytesOutPerSec: 0 };

	return {
		snapshot(at = now()) {
			if (lastAt !== null) push(intervals, at - lastAt, RING);
			lastAt = at;
			total++;
		},

		pong(rtt) {
			push(rtts, Math.max(0, rtt), RTT_RING);
		},

		correction(px) {
			push(corrs, Math.max(0, px), CORR_RING);
		},

		clearCorrection() {
			corrs.length = 0;
		},

		// швидкості оновлюються раз на секунду; bytesIn/bytesOut це накопичені лічильники
		sample({ bytesIn, bytesOut }, at = now()) {
			if (base === null) {
				base = { at, total, bytesIn, bytesOut };
				return;
			}
			const dt = at - base.at;
			if (dt < 1000) return;
			const sec = dt / 1000;
			rates = {
				snapsPerSec: (total - base.total) / sec,
				bytesInPerSec: (bytesIn - base.bytesIn) / sec,
				bytesOutPerSec: (bytesOut - base.bytesOut) / sec,
			};
			base = { at, total, bytesIn, bytesOut };
		},

		read(at = now()) {
			const age = lastAt === null ? null : at - lastAt; // вік знімка
			const sum = rtts.reduce((a, b) => a + b, 0);
			return {
				rtt: rtts.length ? rtts[rtts.length - 1] : null,
				rttAvg: rtts.length ? sum / rtts.length : 0,
				rttMin: rtts.length ? Math.min(...rtts) : 0,
				rttMax: rtts.length ? Math.max(...rtts) : 0,
				age,
				ageMax: Math.max(0, ...intervals, age ?? 0),
				correction: corrs.length ? corrs[corrs.length - 1] : null,
				correctionMax: Math.max(0, ...corrs),
				...rates,
				intervals: [...intervals],
			};
		},
	};
}

const round = (v) => Math.round(v);
const kb = (bytes) => (bytes / 1024).toFixed(1);

// extras: unacked, tick, netsim, interp (interpolator.stats());
// correction і correctionMax (px) перекривають значення з r
export function formatNet(r, extras = {}) {
	const { unacked = 0, tick = 0, netsim = null, interp = null } = extras;
	const corr = extras.correction ?? r.correction ?? null;
	const corrMax = extras.correctionMax ?? r.correctionMax ?? corr;
	const rtt =
		r.rtt === null
			? "—"
			: `${round(r.rtt)} мс (сер. ${round(r.rttAvg)}, макс ${round(r.rttMax)})`;
	const age =
		r.age === null ? "—" : `${round(r.age)} мс (макс ${round(r.ageMax)})`;
	const lines = [
		`RTT:         ${rtt}`,
		`вік знімка:  ${age}`,
		`знімків/с:   ${r.snapsPerSec.toFixed(1)}   tick ${tick}`,
		`↓ ${kb(r.bytesInPerSec)} КБ/с   ↑ ${kb(r.bytesOutPerSec)} КБ/с`,
		`input без ack: ${unacked}`,
		`поправка:    ${corr === null ? "—" : `${corr.toFixed(1)} px (макс ${corrMax.toFixed(1)})`}`,
	];
	if (interp) {
		lines.push(
			`інтерполяція: ${interp.delay} мс · буфер ${interp.buffered} · голод ${round(interp.starvedPct)}%`,
		);
	}
	if (netsim?.enabled) {
		lines.push(
			`мережа:      ${netsim.lag} ± ${netsim.jitter} мс, втрати ${netsim.loss}%`,
		);
	}
	return lines.join("\n");
}
