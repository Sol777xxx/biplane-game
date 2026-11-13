// Вимірювання мережі для netgraph: проміжки між знімками, RTT, швидкості.
// Без DOM і без власних годинників (час передається ззовні), тож перевіряється в Node.
const RING = 120; // проміжків між знімками (~4 с при 30 Гц)
const RTT_RING = 10; // останні RTT (ping раз на секунду: ~10 с)

const push = (list, value, max) => {
	list.push(value);
	if (list.length > max) list.shift();
};

export function createNetStats({ now = () => performance.now() } = {}) {
	const intervals = []; // мс між двома сусідніми знімками
	const rtts = [];
	let lastAt = null; // коли прийшов останній знімок
	let total = 0; // усього знімків
	let base = null; // точка, від якої рахуємо швидкості
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

		// Викликається часто, оновлює швидкості раз на секунду.
		// bytesIn / bytesOut: накопичені лічильники з'єднання (Connection.traffic).
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
			// вік знімка: скільки минуло від приходу останнього
			const age = lastAt === null ? null : at - lastAt;
			const sum = rtts.reduce((a, b) => a + b, 0);
			return {
				rtt: rtts.length ? rtts[rtts.length - 1] : null,
				rttAvg: rtts.length ? sum / rtts.length : 0,
				rttMin: rtts.length ? Math.min(...rtts) : 0,
				rttMax: rtts.length ? Math.max(...rtts) : 0,
				age,
				ageMax: Math.max(0, ...intervals, age ?? 0),
				...rates,
				intervals: [...intervals],
			};
		},
	};
}

const round = (v) => Math.round(v);
const kb = (bytes) => (bytes / 1024).toFixed(1);

// Текст панелі. extras: unacked (input без ack), tick, netsim (стан штучної мережі),
// correction (поправка від звірки, px; null, поки передбачення немає).
export function formatNet(
	r,
	{ unacked = 0, tick = 0, netsim = null, correction = null } = {},
) {
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
		`поправка:    ${correction === null ? "—" : `${correction.toFixed(1)} px`}`,
	];
	if (netsim?.enabled) {
		lines.push(
			`мережа:      ${netsim.lag} ± ${netsim.jitter} мс, втрати ${netsim.loss}%`,
		);
	}
	return lines.join("\n");
}
