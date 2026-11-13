import { formatNet } from "../netStats.js";

const GRAPH_W = 240;
const GRAPH_H = 44;
const GRAPH_MAX_MS = 200; // висота графіка
const GRAPH_BARS = 120;
const REFRESH_MS = 250;

// пресети штучної мережі (кнопки лише якщо сервер дозволяє netsim)
export const PRESETS = [
	{ label: "0", lag: 0, jitter: 0, loss: 0 },
	{ label: "100 ± 30", lag: 100, jitter: 30, loss: 0 },
	{ label: "100 ± 30 + 2%", lag: 100, jitter: 30, loss: 2 },
];

function el(tag, props = {}, ...children) {
	const node = Object.assign(document.createElement(tag), props);
	node.append(...children);
	return node;
}

// стовпчики це проміжки між знімками: рівний ряд ≈33 мс здоровий, високі стовпчики це затримки
function drawGraph(canvas, intervals) {
	const dpr = window.devicePixelRatio || 1;
	if (canvas.width !== Math.round(GRAPH_W * dpr)) {
		canvas.width = Math.round(GRAPH_W * dpr);
		canvas.height = Math.round(GRAPH_H * dpr);
	}
	const g = canvas.getContext("2d");
	g.setTransform(dpr, 0, 0, dpr, 0, 0);
	g.clearRect(0, 0, GRAPH_W, GRAPH_H);

	const barW = GRAPH_W / GRAPH_BARS;
	intervals.forEach((ms, i) => {
		const h = Math.max(1, Math.min(1, ms / GRAPH_MAX_MS) * GRAPH_H);
		g.fillStyle = ms > 100 ? "#c2417d" : ms > 50 ? "#f08ab4" : "#82dcbe";
		const x = GRAPH_W - (intervals.length - i) * barW;
		g.fillRect(x, GRAPH_H - h, Math.max(1, barW - 0.5), h);
	});

	// пунктир на 33 мс: ідеальний інтервал при 30 Гц
	const y = GRAPH_H - (1000 / 30 / GRAPH_MAX_MS) * GRAPH_H;
	g.strokeStyle = "rgba(107, 91, 138, 0.6)";
	g.lineWidth = 1;
	g.setLineDash([3, 3]);
	g.beginPath();
	g.moveTo(0, y);
	g.lineTo(GRAPH_W, y);
	g.stroke();
	g.setLineDash([]);
}

// Панель мережі; клавіша N ховає/показує, update() викликається щокадру.
// session: RoomSession, view: snapshotView, stats: netStats,
// predictor, interp: необов'язкові (кнопка prediction і повзунок затримки).
export function mountNetgraph(
	root,
	{ session, view, stats, predictor = null, interp = null, visible = true },
) {
	const ac = new AbortController();
	const { signal } = ac;

	const text = el("pre", { className: "net-text" });
	const graph = el("canvas", { className: "net-graph" });
	graph.style.width = `${GRAPH_W}px`;
	graph.style.height = `${GRAPH_H}px`;
	const children = [text, graph];

	if (interp) {
		const slider = el("input", {
			type: "range",
			className: "net-range",
			min: 0,
			max: 300,
			step: 10,
			value: interp.delay,
			title: "затримка інтерполяції, мс",
		});
		slider.addEventListener(
			"input",
			() => {
				interp.delay = Number(slider.value);
			},
			{ signal },
		);
		// після відпускання повертаємо клавіатуру грі
		slider.addEventListener("change", () => slider.blur(), { signal });
		children.push(slider);
	}

	if (predictor) {
		const btn = el("button", { type: "button", className: "net-preset" });
		const label = () => {
			btn.textContent = `prediction: ${predictor.enabled ? "on" : "off"}`;
		};
		label();
		btn.addEventListener(
			"click",
			() => {
				predictor.enabled = !predictor.enabled;
				stats.clearCorrection();
				label();
				btn.blur(); // щоб клавіші керування не «натискали» кнопку
			},
			{ signal },
		);
		children.push(el("div", { className: "net-presets" }, btn));
	}

	const presets = el("div", { className: "net-presets", hidden: true });
	for (const preset of PRESETS) {
		const btn = el("button", {
			type: "button",
			className: "net-preset",
			textContent: preset.label,
			title: `lag ${preset.lag} мс, jitter ${preset.jitter} мс, втрати ${preset.loss}%`,
		});
		btn.addEventListener(
			"click",
			() => {
				session.setNetsim(preset);
				btn.blur();
			},
			{ signal },
		);
		presets.append(btn);
	}
	children.push(presets);
	root.replaceChildren(...children);
	root.hidden = !visible;

	// вимірювання йдуть і при схованій панелі
	session.addEventListener(
		"snapshot",
		() => stats.snapshot(performance.now()),
		{
			signal,
		},
	);
	session.addEventListener("pong", (e) => stats.pong(e.detail.rtt), { signal });
	session.addEventListener(
		"netsim",
		(e) => {
			presets.hidden = !e.detail.enabled;
		},
		{ signal },
	);
	if (session.netsim) presets.hidden = !session.netsim.enabled;

	session.ping();
	const pingTimer = setInterval(() => session.ping(), 1000);

	window.addEventListener(
		"keydown",
		(e) => {
			if (e.code !== "KeyN" || e.repeat) return;
			if (e.ctrlKey || e.metaKey || e.altKey) return;
			if (document.activeElement !== document.body) return; // друкуємо в полі
			root.hidden = !root.hidden;
		},
		{ signal },
	);

	let lastDraw = 0;
	let lastText = "";

	return {
		update(time = performance.now()) {
			if (root.hidden || time - lastDraw < REFRESH_MS) return;
			lastDraw = time;
			stats.sample(session.traffic, time);
			const r = stats.read(time);
			const next = formatNet(r, {
				unacked: Math.max(0, session.lastSeq - view.ack),
				tick: view.tick,
				netsim: session.netsim,
				interp: interp?.stats() ?? null,
			});
			if (next !== lastText) {
				text.textContent = next;
				lastText = next;
			}
			drawGraph(graph, r.intervals);
		},
		dispose() {
			clearInterval(pingTimer);
			ac.abort();
		},
	};
}
